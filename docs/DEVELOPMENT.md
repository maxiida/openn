# Developing Openn

Openn is based on [Clash Verge Rev](https://github.com/clash-verge-rev/clash-verge-rev) from its `2.5.5` development line at commit `ac2eb6d1`.

## Repositories

| Repository      | Purpose                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `openn`         | This app                                                                |
| `openn-service` | Privileged service, forked from `clash-verge-rev/clash-verge-service-ipc` |

The build compiles the service from a sibling checkout, so both must sit side by side:

```
Projects/
├── Proxy-MVP/                # this repository
└── clash-verge-service-ipc/  # openn-service, branch `openn`
```

## Development

```bash
pnpm i
pnpm prebuild
pnpm dev
```

## Versioning and releases

Versions follow SemVer, starting over from `0.1.0` (independent of upstream's numbering):

- `0.x.y-alpha.N` — friends-and-family testing
- `0.x.y-beta.N` — wider closed testing
- `1.0.0` — first public release

To release:

1. Move the `Changelog.md` entries under a heading for the new version.
2. `pnpm release-version <version>` and commit.
3. `git tag v<version> && git push origin dev v<version>`

The tag builds the macOS (Apple Silicon) app in GitHub Actions and attaches it, with signed
updater artifacts, to a draft release. Review the draft and publish it.

Upstream fixes are brought in by cherry-picking from the `upstream` remote.
