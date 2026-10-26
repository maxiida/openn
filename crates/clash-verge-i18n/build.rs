fn main() {
    // `i18n!` reads the locale files without telling cargo, so edits to them would not rebuild the crate.
    println!("cargo:rerun-if-changed=locales");
}
