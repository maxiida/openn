use crate::core::handle;
use crate::process::AsyncHandler;
use parking_lot::Mutex;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::image::Image;

use super::TRAY_ID;

const GREEN: [f32; 3] = [52.0, 199.0, 89.0];
const WHITE: [f32; 3] = [255.0, 255.0, 255.0];

/// The menu bar scales the image to a fixed height, so every pixel of padding shrinks the logo.
const PAD: u32 = 3;
const DOT_RADIUS: f32 = 13.0;
/// Clear ring cut out of the logo around the dot so the two shapes stay distinct at menu bar size.
const DOT_GAP: f32 = 4.0;
const IDLE_ALPHA: f32 = 0.35;

const FADE_FRAMES: u32 = 10;
const FRAME_INTERVAL: Duration = Duration::from_millis(30);
const PULSE_INTERVAL: Duration = Duration::from_millis(60);
const PULSE_STEPS: u32 = 16;

#[derive(Clone, Copy)]
struct Visual {
    logo: [f32; 3],
    logo_alpha: f32,
    dot: [f32; 3],
    dot_alpha: f32,
}

impl Visual {
    fn lerp(self, to: Self, t: f32) -> Self {
        let mix = |a: f32, b: f32| a + (b - a) * t;
        Self {
            logo_alpha: mix(self.logo_alpha, to.logo_alpha),
            logo: [
                mix(self.logo[0], to.logo[0]),
                mix(self.logo[1], to.logo[1]),
                mix(self.logo[2], to.logo[2]),
            ],
            dot: [
                mix(self.dot[0], to.dot[0]),
                mix(self.dot[1], to.dot[1]),
                mix(self.dot[2], to.dot[2]),
            ],
            dot_alpha: mix(self.dot_alpha, to.dot_alpha),
        }
    }
}

struct Mask {
    alpha: Vec<u8>,
    width: u32,
    height: u32,
    dot: (f32, f32),
}

/// The logo cropped to its opaque bounds, with room for the status dot at its bottom-right corner.
fn mask() -> &'static Mask {
    static MASK: OnceLock<Mask> = OnceLock::new();
    MASK.get_or_init(|| {
        let img = Image::from_bytes(include_bytes!("../../../icons/tray-logo.png")).expect("embedded tray logo");
        let (src_w, src_h, rgba) = (img.width(), img.height(), img.rgba());
        let src_alpha = |x: u32, y: u32| rgba[((y * src_w + x) * 4 + 3) as usize];

        let (mut x0, mut y0, mut x1, mut y1) = (src_w, src_h, 0, 0);
        for y in 0..src_h {
            for x in 0..src_w {
                if src_alpha(x, y) > 0 {
                    (x0, y0, x1, y1) = (x0.min(x), y0.min(y), x1.max(x), y1.max(y));
                }
            }
        }
        let (logo_w, logo_h) = (x1 - x0 + 1, y1 - y0 + 1);

        let height = logo_h + 2 * PAD;
        let dot = ((PAD + logo_w) as f32 - 0.5, height as f32 - DOT_RADIUS - 1.0);
        let width = (dot.0 + DOT_RADIUS).ceil() as u32 + 1;

        let mut alpha = vec![0u8; (width * height) as usize];
        for y in 0..logo_h {
            for x in 0..logo_w {
                alpha[((y + PAD) * width + x + PAD) as usize] = src_alpha(x + x0, y + y0);
            }
        }
        Mask {
            alpha,
            width,
            height,
            dot,
        }
    })
}

fn render(v: Visual) -> Image<'static> {
    let Mask {
        alpha,
        width,
        height,
        dot,
    } = mask();
    let mut out = vec![0u8; alpha.len() * 4];
    for y in 0..*height {
        for x in 0..*width {
            let i = (y * width + x) as usize;
            let (px, py) = (x as f32 + 0.5, y as f32 + 0.5);
            let d = ((px - dot.0).powi(2) + (py - dot.1).powi(2)).sqrt();
            let cover = |r: f32| (r - d + 0.5).clamp(0.0, 1.0);
            let la = f32::from(alpha[i]) / 255.0 * v.logo_alpha * (1.0 - cover(DOT_RADIUS + DOT_GAP) * v.dot_alpha);
            let da = cover(DOT_RADIUS) * v.dot_alpha;
            let oa = la + da * (1.0 - la);
            if oa <= 0.0 {
                continue;
            }
            for c in 0..3 {
                out[i * 4 + c] = ((v.logo[c] * la + v.dot[c] * da * (1.0 - la)) / oa).round() as u8;
            }
            out[i * 4 + 3] = (oa * 255.0).round() as u8;
        }
    }
    Image::new_owned(out, *width, *height)
}

pub fn global() -> &'static StatusIcon {
    static ICON: OnceLock<StatusIcon> = OnceLock::new();
    ICON.get_or_init(StatusIcon::new)
}

pub struct StatusIcon {
    generation: AtomicU64,
    connecting: AtomicBool,
    current: Mutex<Visual>,
}

impl StatusIcon {
    pub const fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            connecting: AtomicBool::new(false),
            current: Mutex::new(Self::idle()),
        }
    }

    const fn idle() -> Visual {
        Visual {
            logo: WHITE,
            logo_alpha: IDLE_ALPHA,
            dot: GREEN,
            dot_alpha: 0.0,
        }
    }

    const fn connected_visual() -> Visual {
        Visual {
            logo: WHITE,
            logo_alpha: 1.0,
            dot: GREEN,
            dot_alpha: 1.0,
        }
    }

    const fn connecting_visual(alpha: f32) -> Visual {
        Visual {
            logo: WHITE,
            logo_alpha: 1.0,
            dot: WHITE,
            dot_alpha: alpha,
        }
    }

    pub fn initial_image(&self, connected: bool) -> Image<'static> {
        let v = if connected {
            Self::connected_visual()
        } else {
            Self::idle()
        };
        *self.current.lock() = v;
        render(v)
    }

    pub fn set_connecting(&self, connecting: bool) {
        self.connecting.store(connecting, Ordering::SeqCst);
    }

    pub fn is_connecting(&self) -> bool {
        self.connecting.load(Ordering::SeqCst)
    }

    /// Animates the tray icon towards the state implied by `connected` (or the pulsing "connecting" state).
    pub fn sync(&'static self, connected: bool) {
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let connecting = self.is_connecting();
        AsyncHandler::spawn(move || async move {
            let from = *self.current.lock();
            if connecting {
                if !self.fade(generation, from, Self::connecting_visual(1.0)).await {
                    return;
                }
                self.pulse(generation).await;
            } else {
                let target = if connected {
                    Self::connected_visual()
                } else {
                    Self::idle()
                };
                self.fade(generation, from, target).await;
            }
        });
    }

    fn is_current(&self, generation: u64) -> bool {
        self.generation.load(Ordering::SeqCst) == generation && !handle::Handle::global().is_exiting()
    }

    fn show(&self, v: Visual) {
        *self.current.lock() = v;
        if let Some(tray) = handle::Handle::app_handle().tray_by_id(TRAY_ID) {
            let _ = tray.set_icon_with_as_template(Some(render(v)), false);
        }
    }

    async fn fade(&self, generation: u64, from: Visual, to: Visual) -> bool {
        for step in 1..=FADE_FRAMES {
            if !self.is_current(generation) {
                return false;
            }
            let t = step as f32 / FADE_FRAMES as f32;
            self.show(from.lerp(to, t * t * (3.0 - 2.0 * t)));
            tokio::time::sleep(FRAME_INTERVAL).await;
        }
        true
    }

    async fn pulse(&self, generation: u64) {
        let mut step = 0u32;
        while self.is_current(generation) {
            let phase = (step % (PULSE_STEPS * 2)) as f32 / PULSE_STEPS as f32;
            let wave = if phase <= 1.0 { phase } else { 2.0 - phase };
            self.show(Self::connecting_visual(0.35 + 0.65 * wave));
            step += 1;
            tokio::time::sleep(PULSE_INTERVAL).await;
        }
    }
}
