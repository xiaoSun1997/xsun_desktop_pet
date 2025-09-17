// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod window_utils;
mod clipboard;

fn main() {
    xsun_desktop_pet_lib::run()
}
