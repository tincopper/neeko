# Migrate crate::models imports to canonical domain paths

## Goal
Replace all `use crate::models::*` / `use crate::models::{...}` with imports from canonical domain type modules. Remove `pub mod models;` from lib.rs.

## Why
ADAM "backend domain module reorganization" was committed (ce103d0) but not completed — 21 files still go through the compatibility shim. Closing this prevents domain coupling through the re-export mesh.
