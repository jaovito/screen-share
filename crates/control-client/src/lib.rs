//! Narrow control API transport. Authentication cookies remain in native memory.
mod policy;

use reqwest::{Client, redirect::Policy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::Duration;
use url::Url;

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "UPPERCASE")]
pub enum Method {
    Get,
    Post,
    Delete,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRequest {
    pub method: Method,
    pub path: String,
    pub body: Option<Value>,
}

#[derive(Serialize)]
pub struct ControlResponse {
    pub status: u16,
    pub body: Value,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ControlError {
    InvalidServer,
    InvalidRequest,
    Unavailable,
    InvalidResponse,
}

#[derive(Clone)]
pub struct ControlClient {
    client: Client,
    base: Url,
}

impl ControlClient {
    pub fn new(base: &str) -> Result<Self, ControlError> {
        let base = policy::server(base)?;
        let client = Client::builder()
            .cookie_store(true)
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| ControlError::Unavailable)?;
        Ok(Self { client, base })
    }

    pub async fn request(&self, request: ControlRequest) -> Result<ControlResponse, ControlError> {
        if !policy::route(request.method, &request.path) {
            return Err(ControlError::InvalidRequest);
        }
        if request.method == Method::Get && request.body.is_some() {
            return Err(ControlError::InvalidRequest);
        }
        let body = request.body.map(|body| body.to_string());
        if body.as_ref().is_some_and(|body| body.len() > 16384) {
            return Err(ControlError::InvalidRequest);
        }
        let url = self
            .base
            .join(&request.path)
            .map_err(|_| ControlError::InvalidRequest)?;
        let method = match request.method {
            Method::Get => reqwest::Method::GET,
            Method::Post => reqwest::Method::POST,
            Method::Delete => reqwest::Method::DELETE,
        };
        let mut builder = self
            .client
            .request(method, url)
            .header("Origin", self.base.origin().ascii_serialization())
            .header("Accept", "application/json");
        if let Some(body) = body {
            builder = builder
                .header("Content-Type", "application/json")
                .body(body);
        }
        let mut response = builder
            .send()
            .await
            .map_err(|_| ControlError::Unavailable)?;
        let status = response.status().as_u16();
        if (300..400).contains(&status) {
            return Err(ControlError::InvalidResponse);
        }
        if response.content_length().is_some_and(|len| len > 131072) {
            return Err(ControlError::InvalidResponse);
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| ControlError::InvalidResponse)?
        {
            if bytes.len() + chunk.len() > 131072 {
                return Err(ControlError::InvalidResponse);
            }
            bytes.extend_from_slice(&chunk);
        }
        let body = if bytes.is_empty() {
            serde_json::json!({})
        } else {
            serde_json::from_slice(&bytes).map_err(|_| ControlError::InvalidResponse)?
        };
        // Session cookies and bearer equivalents must never return through IPC.
        // RTC grants are intentionally separate product responses, not auth tokens.
        let body = if request.path.starts_with("/api/auth/") {
            if !(200..300).contains(&status) {
                serde_json::json!({"error": "authentication_failed"})
            } else if body.is_null() {
                Value::Null
            } else if let Some(user) = body.get("user") {
                serde_json::json!({"user": user})
            } else {
                serde_json::json!({})
            }
        } else {
            body
        };
        Ok(ControlResponse { status, body })
    }
}

#[cfg(test)]
mod tests;
