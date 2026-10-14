use crate::{config::MixedPort, utils::help};
use anyhow::{Context as _, Result};
use base64::{Engine as _, engine::general_purpose};
use clash_verge_logging::{Type, logging};
use reqwest::{
    Client, Proxy, StatusCode,
    header::{HeaderMap, HeaderValue, USER_AGENT},
};
use serde::Deserialize;
use smartstring::alias::String;
use std::{
    io::Write as _,
    net::{IpAddr, SocketAddr, ToSocketAddrs as _},
    process::{Command, Stdio},
    sync::Arc,
    time::{Duration, Instant},
};
use sysproxy::Sysproxy;
use tauri::Url;

const DIRECT_RETRY_DELAY: Duration = Duration::from_millis(250);
const DIRECT_DOH_URL: &str = "https://doh.pub/dns-query";
const DIRECT_DOH_TIMEOUT: Duration = Duration::from_secs(8);
/// Subscription panels pick node protocols by this client version, so it stays at the upstream
/// release Openn is based on instead of following Openn's own version.
const DEFAULT_USER_AGENT: &str = "clash-verge/v2.5.5";

#[derive(Debug, Deserialize)]
struct DnsJsonResponse {
    #[serde(rename = "Status")]
    status: u32,
    #[serde(rename = "Answer", default)]
    answers: Vec<DnsJsonAnswer>,
}

#[derive(Debug, Deserialize)]
struct DnsJsonAnswer {
    #[serde(rename = "type")]
    record_type: u16,
    data: std::string::String,
}

#[derive(Debug)]
pub struct HttpResponse {
    status: StatusCode,
    headers: HeaderMap,
    body: String,
}

impl HttpResponse {
    const fn new(status: StatusCode, headers: HeaderMap, body: String) -> Self {
        Self { status, headers, body }
    }

    pub const fn status(&self) -> StatusCode {
        self.status
    }

    pub const fn headers(&self) -> &HeaderMap {
        &self.headers
    }

    pub fn text(&self) -> &str {
        &self.body
    }
}

#[derive(Debug, Clone, Copy)]
pub enum ProxyType {
    None,
    Localhost,
    System,
}

#[derive(Debug, Clone, Copy)]
enum TlsRootMode {
    PlatformVerifier,
    StaticWebpkiRoots,
}

pub struct NetworkManager;

impl NetworkManager {
    pub const fn new() -> Self {
        Self
    }

    fn build_client(
        &self,
        proxy_url: Option<std::string::String>,
        default_headers: HeaderMap,
        accept_invalid_certs: bool,
        timeout_secs: Option<u64>,
        tls_root_mode: TlsRootMode,
        dns_override: Option<(&str, &[SocketAddr])>,
    ) -> Result<Client> {
        let mut builder = Client::builder()
            .tls_backend_rustls()
            .redirect(reqwest::redirect::Policy::limited(10))
            .tcp_keepalive(Duration::from_secs(60))
            .pool_max_idle_per_host(0)
            .pool_idle_timeout(None);

        if matches!(tls_root_mode, TlsRootMode::StaticWebpkiRoots) {
            builder = builder.tls_backend_preconfigured(Self::build_static_webpki_tls_config()?);
        }

        // 设置代理
        if let Some(proxy_str) = proxy_url {
            let proxy = Proxy::all(proxy_str)?;
            builder = builder.proxy(proxy);
        } else {
            builder = builder.no_proxy();
        }

        if let Some((host, addrs)) = dns_override {
            builder = builder.resolve_to_addrs(host, addrs);
        }

        builder = builder.default_headers(default_headers);

        // SSL/TLS
        if accept_invalid_certs {
            builder = builder
                .danger_accept_invalid_certs(true)
                .danger_accept_invalid_hostnames(true);
        }

        // 超时设置
        if let Some(secs) = timeout_secs {
            builder = builder
                .timeout(Duration::from_secs(secs))
                .connect_timeout(Duration::from_secs(secs.min(30)));
        }

        Ok(builder.build()?)
    }

    fn build_static_webpki_tls_config() -> Result<rustls::ClientConfig> {
        let root_store = rustls::RootCertStore::from_iter(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
        let mut config =
            rustls::ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
                .with_safe_default_protocol_versions()?
                .with_root_certificates(root_store)
                .with_no_client_auth();

        config.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

        Ok(config)
    }

    fn should_retry_with_static_webpki_roots(err: &anyhow::Error) -> bool {
        if err.chain().any(Self::is_legacy_tls_protocol_error) {
            return false;
        }

        err.chain().any(|e| {
            let msg = e.to_string().to_ascii_lowercase();
            [
                "certificate",
                "cert",
                "tls",
                "ssl",
                "rustls",
                "webpki",
                "revocation",
                "ocsp",
                "crl",
                "issuer",
                "unknownissuer",
            ]
            .iter()
            .any(|kw| msg.contains(kw))
        })
    }

    fn context_reqwest_error(err: reqwest::Error, context: &'static str) -> anyhow::Error {
        let legacy_tls = Self::is_legacy_tls_protocol_error(&err);
        let classification = format!(
            "is_connect={} is_timeout={} is_request={} is_dns={} is_redirect={} is_body={} is_decode={}",
            err.is_connect(),
            err.is_timeout(),
            err.is_request(),
            err.is_dns(),
            err.is_redirect(),
            err.is_body(),
            err.is_decode()
        );
        let err = anyhow::Error::new(err.without_url())
            .context(classification)
            .context(context);

        if legacy_tls {
            err.context("Subscription server uses legacy TLS; only TLS 1.2/1.3 is supported. TLS 1.0/1.1 is insecure")
        } else {
            err
        }
    }

    fn is_legacy_tls_protocol_error(err: &(dyn std::error::Error + 'static)) -> bool {
        let detail = format!("{err:#?}").to_ascii_lowercase();
        detail.contains("protocolversion") || detail.contains("protocol version")
    }

    async fn get_with_tls_mode(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
        tls_root_mode: TlsRootMode,
        resolved_addrs: Option<&[SocketAddr]>,
    ) -> Result<HttpResponse> {
        let mut parsed = Url::parse(url)?;
        let request_host = parsed.host_str().map(str::to_owned);
        let mut extra_headers = HeaderMap::new();

        if !parsed.username().is_empty() {
            let username = percent_encoding::percent_decode_str(parsed.username())
                .decode_utf8_lossy()
                .into_owned();
            let password = percent_encoding::percent_decode_str(parsed.password().unwrap_or_default())
                .decode_utf8_lossy()
                .into_owned();
            let auth_str = format!("{}:{}", username, password);
            let encoded = general_purpose::STANDARD.encode(auth_str);
            extra_headers.insert("Authorization", HeaderValue::from_str(&format!("Basic {}", encoded))?);
        }

        parsed.set_username("").ok();
        parsed.set_password(None).ok();

        // 创建请求
        let client = self
            .create_request_with_tls_mode(
                proxy_type,
                timeout_secs,
                user_agent,
                accept_invalid_certs,
                tls_root_mode,
                request_host
                    .as_deref()
                    .zip(resolved_addrs)
                    .map(|(host, addrs)| (host, addrs)),
            )
            .await?;

        let started = Instant::now();
        let mut request_builder = client.get(parsed);

        for (key, value) in extra_headers.iter() {
            request_builder = request_builder.header(key, value);
        }

        let response = match request_builder.send().await {
            Ok(resp) => resp,
            Err(e) => {
                return Err(Self::context_reqwest_error(e, "Request failed"));
            }
        };

        let status = response.status();
        #[cfg(debug_assertions)]
        logging!(
            info,
            Type::Network,
            "DIRECT diagnostic phase=http_response host={} status={} version={:?} redirected={} elapsed_ms={}",
            request_host.as_deref().unwrap_or("<missing>"),
            status,
            response.version(),
            request_host.as_deref() != response.url().host_str(),
            started.elapsed().as_millis()
        );
        let headers = response.headers().to_owned();
        let body = match response.text().await {
            Ok(text) => text.into(),
            Err(e) => {
                return Err(Self::context_reqwest_error(e, "Failed to read response body"));
            }
        };

        Ok(HttpResponse::new(status, headers, body))
    }

    async fn create_request_with_tls_mode(
        &self,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
        tls_root_mode: TlsRootMode,
        dns_override: Option<(&str, &[SocketAddr])>,
    ) -> Result<Client> {
        let proxy_url: Option<std::string::String> = match proxy_type {
            ProxyType::None => None,
            ProxyType::Localhost => {
                let port = MixedPort::desired().await;
                Some(format!("http://127.0.0.1:{port}"))
            }
            ProxyType::System => {
                if let Ok(p @ Sysproxy { enable: true, .. }) = Sysproxy::get_system_proxy() {
                    Some(format!("http://{}:{}", p.host, p.port))
                } else {
                    None
                }
            }
        };

        let mut headers = HeaderMap::new();

        // 设置 User-Agent
        if let Some(ua) = user_agent {
            headers.insert(USER_AGENT, HeaderValue::from_str(ua.as_str())?);
        } else {
            headers.insert(
                USER_AGENT,
                HeaderValue::from_static(DEFAULT_USER_AGENT),
            );
        }

        self.build_client(
            proxy_url,
            headers,
            accept_invalid_certs,
            timeout_secs,
            tls_root_mode,
            dns_override,
        )
    }

    fn request_phase(err: &anyhow::Error) -> &'static str {
        let Some(reqwest_err) = err.chain().find_map(|cause| cause.downcast_ref::<reqwest::Error>()) else {
            return "unknown";
        };
        let chain = format!("{reqwest_err:#}").to_ascii_lowercase();

        if reqwest_err.is_dns() {
            "dns_resolution"
        } else if reqwest_err.is_connect()
            && ["tls", "ssl", "rustls", "certificate", "handshake"]
                .iter()
                .any(|marker| chain.contains(marker))
        {
            "tls_handshake"
        } else if reqwest_err.is_connect() {
            "tcp_connect"
        } else if reqwest_err.is_redirect() {
            "redirect"
        } else if reqwest_err.is_body() || reqwest_err.is_decode() {
            "http_response_body"
        } else if reqwest_err.is_timeout() {
            "total_timeout"
        } else if reqwest_err.is_request() {
            "http_request"
        } else {
            "unknown"
        }
    }

    fn should_retry_direct(err: &anyhow::Error) -> bool {
        err.chain()
            .find_map(|cause| cause.downcast_ref::<reqwest::Error>())
            .is_some_and(|error| error.is_dns() || error.is_connect() || error.is_timeout())
    }

    fn log_request_failure(host: &str, attempt: &str, started: Instant, err: &anyhow::Error) {
        #[cfg(debug_assertions)]
        {
            let detail = help::mask_err(&format!("{err:#}"));
            logging!(
                warn,
                Type::Network,
                "DIRECT diagnostic phase={} host={} attempt={} elapsed_ms={} error_chain={}",
                Self::request_phase(err),
                host,
                attempt,
                started.elapsed().as_millis(),
                detail
            );
        }
    }

    #[cfg(debug_assertions)]
    async fn log_system_dns(host: &str, port: u16) {
        let host = host.to_owned();
        let logged_host = host.clone();
        let started = Instant::now();
        let result = tokio::task::spawn_blocking(move || {
            (host.as_str(), port)
                .to_socket_addrs()
                .map(|addrs| addrs.collect::<Vec<_>>())
        })
        .await;

        match result {
            Ok(Ok(addrs)) => logging!(
                info,
                Type::Network,
                "DIRECT diagnostic phase=dns_resolution host={} elapsed_ms={} addresses={:?}",
                logged_host,
                started.elapsed().as_millis(),
                addrs
            ),
            Ok(Err(err)) => logging!(
                warn,
                Type::Network,
                "DIRECT diagnostic phase=dns_resolution host={} elapsed_ms={} error={}",
                logged_host,
                started.elapsed().as_millis(),
                err
            ),
            Err(err) => logging!(
                warn,
                Type::Network,
                "DIRECT diagnostic phase=dns_resolution host={} elapsed_ms={} task_error={}",
                logged_host,
                started.elapsed().as_millis(),
                err
            ),
        }
    }

    async fn resolve_ipv4_with_doh(&self, host: &str) -> Result<Vec<SocketAddr>> {
        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("clash-verge-direct-dns"));
        headers.insert("accept", HeaderValue::from_static("application/dns-json"));
        let client = self.build_client(
            None,
            headers,
            false,
            Some(DIRECT_DOH_TIMEOUT.as_secs()),
            TlsRootMode::PlatformVerifier,
            None,
        )?;
        let response = client
            .get(DIRECT_DOH_URL)
            .query(&[("name", host), ("type", "A")])
            .send()
            .await
            .map_err(|error| Self::context_reqwest_error(error, "Secure DNS request failed"))?;
        let status = response.status();
        if !status.is_success() {
            anyhow::bail!("secure DNS request failed with status {status}");
        }
        let answer = response
            .json::<DnsJsonResponse>()
            .await
            .map_err(|error| Self::context_reqwest_error(error, "Secure DNS response decode failed"))?;
        if answer.status != 0 {
            anyhow::bail!("secure DNS returned status {}", answer.status);
        }
        let addrs = answer
            .answers
            .into_iter()
            .filter(|answer| answer.record_type == 1)
            .filter_map(|answer| answer.data.parse::<IpAddr>().ok())
            .filter(IpAddr::is_ipv4)
            .map(|ip| SocketAddr::new(ip, 0))
            .collect::<Vec<_>>();
        if addrs.is_empty() {
            anyhow::bail!("secure DNS returned no IPv4 addresses");
        }

        #[cfg(debug_assertions)]
        logging!(
            info,
            Type::Network,
            "DIRECT diagnostic phase=secure_dns_resolution host={} addresses={:?}",
            host,
            addrs
        );
        Ok(addrs)
    }

    async fn get_with_tls_fallback(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
        resolved_addrs: Option<&[SocketAddr]>,
    ) -> Result<HttpResponse> {
        let platform_result = self
            .get_with_tls_mode(
                url,
                proxy_type,
                timeout_secs,
                user_agent.clone(),
                accept_invalid_certs,
                TlsRootMode::PlatformVerifier,
                resolved_addrs,
            )
            .await;

        match platform_result {
            Ok(response) => Ok(response),
            Err(err) if !accept_invalid_certs && Self::should_retry_with_static_webpki_roots(&err) => self
                .get_with_tls_mode(
                    url,
                    proxy_type,
                    timeout_secs,
                    user_agent,
                    accept_invalid_certs,
                    TlsRootMode::StaticWebpkiRoots,
                    resolved_addrs,
                )
                .await
                .map_err(|fallback_err| {
                    fallback_err.context("static webpki roots fallback failed after platform TLS verifier failed")
                }),
            Err(err) => Err(err),
        }
    }

    #[cfg(target_os = "macos")]
    async fn get_with_macos_curl(
        &self,
        url: &str,
        host: &str,
        port: u16,
        resolved_addrs: &[SocketAddr],
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<HttpResponse> {
        const META_MARKER: &str = "__CLASH_VERGE_CURL_META__";

        let url = url.to_owned();
        let host = host.to_owned();
        let resolved_addrs = resolved_addrs.to_vec();
        let timeout_secs = timeout_secs.unwrap_or(20).max(10);
        let user_agent = user_agent.unwrap_or_else(|| DEFAULT_USER_AGENT.into());

        tokio::task::spawn_blocking(move || {
            let mut command = Command::new("/usr/bin/curl");
            let write_out = format!(
                "%{{stderr}}{META_MARKER}\n%{{response_code}}\n%{{http_version}}\n%{{time_namelookup}}\n%{{time_connect}}\n\
                 %{{time_appconnect}}\n%{{time_starttransfer}}\n%{{time_total}}\n%{{num_redirects}}\n%{{header_json}}"
            );
            command.args([
                "--config",
                "-",
                "--proxy",
                "",
                "--ipv4",
                "--location",
                "--max-redirs",
                "10",
                "--silent",
                "--show-error",
                "--compressed",
                "--connect-timeout",
                &timeout_secs.to_string(),
                "--max-time",
                &timeout_secs.to_string(),
                "--user-agent",
                user_agent.as_str(),
                "--write-out",
                write_out.as_str(),
            ]);
            if accept_invalid_certs {
                command.arg("--insecure");
            }
            for addr in &resolved_addrs {
                command.args(["--resolve", &format!("{host}:{port}:{}", addr.ip())]);
            }
            for key in [
                "HTTP_PROXY",
                "HTTPS_PROXY",
                "ALL_PROXY",
                "NO_PROXY",
                "http_proxy",
                "https_proxy",
                "all_proxy",
                "no_proxy",
            ] {
                command.env_remove(key);
            }
            command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());

            let mut child = command.spawn().context("failed to start macOS curl")?;
            let escaped_url = url.replace('\\', "\\\\").replace('"', "\\\"");
            child
                .stdin
                .take()
                .context("failed to open macOS curl stdin")?
                .write_all(format!("url = \"{escaped_url}\"\n").as_bytes())
                .context("failed to pass request URL to macOS curl")?;
            let output = child.wait_with_output().context("failed to wait for macOS curl")?;
            let stderr = std::string::String::from_utf8_lossy(&output.stderr);
            let (curl_error, metadata) = stderr
                .split_once(META_MARKER)
                .ok_or_else(|| anyhow::anyhow!("macOS curl returned no response metadata"))?;
            if !output.status.success() {
                anyhow::bail!("macOS curl failed: {}", help::mask_err(curl_error.trim()));
            }

            let mut metadata = metadata.trim_start_matches(['\r', '\n']).splitn(9, '\n');
            let status = metadata
                .next()
                .context("macOS curl metadata omitted HTTP status")?
                .parse::<u16>()?;
            let http_version = metadata.next().unwrap_or("unknown");
            let dns_time = metadata.next().unwrap_or("unknown");
            let connect_time = metadata.next().unwrap_or("unknown");
            let tls_time = metadata.next().unwrap_or("unknown");
            let first_byte_time = metadata.next().unwrap_or("unknown");
            let total_time = metadata.next().unwrap_or("unknown");
            let redirects = metadata.next().unwrap_or("unknown");
            let header_json = metadata.next().unwrap_or("{}");

            #[cfg(debug_assertions)]
            logging!(
                info,
                Type::Network,
                "DIRECT diagnostic phase=macos_curl_response host={} status={} http={} dns_s={} connect_s={} tls_s={} first_byte_s={} total_s={} redirects={}",
                host,
                status,
                http_version,
                dns_time,
                connect_time,
                tls_time,
                first_byte_time,
                total_time,
                redirects
            );

            let mut headers = HeaderMap::new();
            let parsed_headers = serde_json::from_str::<std::collections::HashMap<String, Vec<String>>>(header_json)
                .context("failed to decode macOS curl response headers")?;
            for (name, values) in parsed_headers {
                let name = reqwest::header::HeaderName::from_bytes(name.as_bytes())?;
                for value in values {
                    headers.append(&name, HeaderValue::from_str(&value)?);
                }
            }

            Ok(HttpResponse::new(
                StatusCode::from_u16(status)?,
                headers,
                std::string::String::from_utf8_lossy(&output.stdout)
                    .into_owned()
                    .into(),
            ))
        })
        .await
        .context("macOS curl task failed")?
    }

    pub async fn get(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        user_agent: Option<String>,
        accept_invalid_certs: bool,
    ) -> Result<HttpResponse> {
        let parsed = Url::parse(url)?;
        let host = parsed
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("request URL has no host"))?
            .to_owned();
        let port = parsed.port_or_known_default().unwrap_or(443);
        #[cfg(debug_assertions)]
        if matches!(proxy_type, ProxyType::None) {
            Self::log_system_dns(&host, port).await;
        }

        let first_started = Instant::now();
        let first = self
            .get_with_tls_fallback(
                url,
                proxy_type,
                timeout_secs,
                user_agent.clone(),
                accept_invalid_certs,
                None,
            )
            .await;
        let initial_error = match first {
            Ok(response) => return Ok(response),
            Err(err) => err,
        };
        Self::log_request_failure(&host, "system_dns", first_started, &initial_error);

        if !matches!(proxy_type, ProxyType::None) || !Self::should_retry_direct(&initial_error) {
            return Err(initial_error);
        }

        tokio::time::sleep(DIRECT_RETRY_DELAY).await;
        let resolved_addrs = self
            .resolve_ipv4_with_doh(&host)
            .await
            .with_context(|| format!("secure DNS direct retry could not resolve host {host}"))?;
        let retry_started = Instant::now();
        #[cfg(target_os = "macos")]
        let retry = self
            .get_with_macos_curl(
                url,
                &host,
                port,
                &resolved_addrs,
                timeout_secs,
                user_agent,
                accept_invalid_certs,
            )
            .await;
        #[cfg(not(target_os = "macos"))]
        let retry = self
            .get_with_tls_fallback(
                url,
                ProxyType::None,
                Some(timeout_secs.unwrap_or(20).max(10)),
                user_agent,
                accept_invalid_certs,
                Some(&resolved_addrs),
            )
            .await;
        if let Err(err) = &retry {
            Self::log_request_failure(&host, "secure_dns", retry_started, err);
        }
        retry
    }

    async fn get_bytes_with_tls_mode(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        max_bytes: usize,
        tls_root_mode: TlsRootMode,
    ) -> Result<Vec<u8>> {
        let client = self
            .create_request_with_tls_mode(proxy_type, timeout_secs, None, false, tls_root_mode, None)
            .await?;

        let mut response = client
            .get(url)
            .send()
            .await
            .map_err(|e| Self::context_reqwest_error(e, "Request failed"))?;

        let status = response.status();
        if !status.is_success() {
            anyhow::bail!("request failed with status {status}");
        }

        let mut body = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| Self::context_reqwest_error(e, "Failed to read response body"))?
        {
            if body.len() + chunk.len() > max_bytes {
                anyhow::bail!("response exceeded the {max_bytes} byte limit");
            }
            body.extend_from_slice(&chunk);
        }

        Ok(body)
    }

    /// Downloads a binary body, mirroring the TLS fallback of [`Self::get`].
    pub async fn get_bytes(
        &self,
        url: &str,
        proxy_type: ProxyType,
        timeout_secs: Option<u64>,
        max_bytes: usize,
    ) -> Result<Vec<u8>> {
        let platform_result = self
            .get_bytes_with_tls_mode(url, proxy_type, timeout_secs, max_bytes, TlsRootMode::PlatformVerifier)
            .await;

        match platform_result {
            Ok(body) => Ok(body),
            Err(err) if Self::should_retry_with_static_webpki_roots(&err) => self
                .get_bytes_with_tls_mode(url, proxy_type, timeout_secs, max_bytes, TlsRootMode::StaticWebpkiRoots)
                .await
                .map_err(|fallback_err| {
                    fallback_err.context("static webpki roots fallback failed after platform TLS verifier failed")
                }),
            Err(err) => Err(err),
        }
    }
}
