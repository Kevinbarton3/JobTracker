mod app_backend;
pub mod capture_transport;
#[allow(dead_code)]
mod email;

pub fn run() {
    app_backend::run();
}
