use std::{collections::HashMap, net::IpAddr};
use tauri::{
    Url,
    utils::config::{Config, Csp, CspDirectiveSources},
};

type Directives = HashMap<String, CspDirectiveSources>;

fn origins(value: &str) -> Result<[String; 2], &'static str> {
    if value.len() > 2048
        || value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err("invalid_rtc_origin");
    }
    let mut url = Url::parse(value).map_err(|_| "invalid_rtc_origin")?;
    let host = url.host_str().ok_or("invalid_rtc_origin")?;
    let ip = host.trim_matches(['[', ']']).parse::<IpAddr>();
    let dns = host.len() <= 253
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        });
    let loopback = host == "localhost" || ip.as_ref().is_ok_and(|ip| ip.is_loopback());
    if (!dns && ip.is_err())
        || !matches!(url.scheme(), "ws" | "wss")
        || (url.scheme() == "ws" && !loopback)
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/"
    {
        return Err("invalid_rtc_origin");
    }
    let websocket = url.origin().ascii_serialization();
    let scheme = if url.scheme() == "wss" {
        "https"
    } else {
        "http"
    };
    url.set_scheme(scheme).map_err(|_| "invalid_rtc_origin")?;
    Ok([websocket, url.origin().ascii_serialization()])
}

fn extend(directives: &mut Directives, directive: &str, sources: &[&str]) {
    let mut existing: Vec<String> = directives
        .remove(directive)
        .map(Into::into)
        .unwrap_or_default();
    for source in sources {
        if !existing.iter().any(|entry| entry == source) {
            existing.push((*source).to_owned());
        }
    }
    directives.insert(directive.to_owned(), CspDirectiveSources::List(existing));
}

fn policy(csp: Csp, rtc: &[String; 2]) -> Csp {
    let mut directives: Directives = csp.into();
    extend(&mut directives, "connect-src", &[&rtc[0], &rtc[1]]);
    extend(&mut directives, "worker-src", &["'self'", "blob:"]);
    extend(&mut directives, "media-src", &["'self'", "blob:"]);
    directives.into()
}

pub fn configure(config: &mut Config, rtc_url: &str) -> Result<(), &'static str> {
    let rtc = origins(rtc_url)?;
    let security = &mut config.app.security;
    let csp = security.csp.clone().ok_or("missing_media_policy")?;
    security.csp = Some(policy(csp, &rtc));
    security.dev_csp = security.dev_csp.clone().map(|csp| policy(csp, &rtc));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> Config {
        serde_json::from_str(include_str!("../tauri.conf.json"))
            .expect("valid desktop configuration")
    }

    fn sources(csp: Csp, name: &str) -> Vec<String> {
        let mut directives: Directives = csp.into();
        directives.remove(name).expect("expected directive").into()
    }

    #[test]
    fn allows_only_the_configured_rtc_origins_and_local_worker_media() {
        let mut config = config();
        configure(&mut config, "wss://rtc.screenshare.dev:7443/").unwrap();
        for csp in [config.app.security.csp, config.app.security.dev_csp] {
            let csp = csp.unwrap();
            let connect = sources(csp.clone(), "connect-src");
            assert!(connect.contains(&"wss://rtc.screenshare.dev:7443".into()));
            assert!(connect.contains(&"https://rtc.screenshare.dev:7443".into()));
            assert!(
                !connect
                    .iter()
                    .any(|source| ["*", "https:", "wss:"].contains(&source.as_str()))
            );
            assert_eq!(sources(csp.clone(), "worker-src"), ["'self'", "blob:"]);
            assert_eq!(sources(csp, "media-src"), ["'self'", "blob:"]);
        }
    }

    #[test]
    fn preserves_nonce_hashes_other_directives_and_updater_configuration() {
        let mut config = config();
        config.app.security.csp = Some(Csp::Policy(
            "default-src 'self'; script-src 'self' 'nonce-proof' 'sha256-proof'; connect-src ipc: https://ipc.localhost".into(),
        ));
        config
            .plugins
            .0
            .insert("updater".into(), serde_json::json!({"pubkey": "proof"}));
        let before = config.clone();
        configure(&mut config, "ws://127.0.0.1:7880").unwrap();
        configure(&mut config, "ws://127.0.0.1:7880").unwrap();
        let csp = config.app.security.csp.unwrap();
        assert_eq!(
            sources(csp.clone(), "script-src"),
            ["'self'", "'nonce-proof'", "'sha256-proof'"]
        );
        assert_eq!(sources(csp.clone(), "default-src"), ["'self'"]);
        assert_eq!(
            sources(csp, "connect-src"),
            [
                "ipc:",
                "https://ipc.localhost",
                "ws://127.0.0.1:7880",
                "http://127.0.0.1:7880"
            ]
        );
        assert_eq!(config.plugins.0, before.plugins.0);
        assert_eq!(
            config.app.windows[0].use_https_scheme,
            before.app.windows[0].use_https_scheme
        );
    }

    #[test]
    fn accepts_secure_origins_and_insecure_loopback_only() {
        for value in [
            "ws://localhost:7880",
            "ws://127.0.0.1:7880",
            "ws://[::1]:7880",
            "wss://rtc.screenshare.dev",
        ] {
            assert!(origins(value).is_ok(), "{value}");
        }
    }

    #[test]
    fn rejects_invalid_configuration_without_mutating_policy() {
        for value in [
            "",
            "https://rtc.screenshare.dev",
            "ws://rtc.screenshare.dev",
            "ws://192.168.1.2:7880",
            "wss://user:secret@rtc.screenshare.dev",
            "wss://rtc.screenshare.dev/room",
            "wss://rtc.screenshare.dev?token=secret",
            "wss://rtc.screenshare.dev#fragment",
            "wss://rtc.screenshare.dev\n",
            "wss://rtc.screenshare.dev\u{0000}",
            "wss://*.screenshare.dev",
            "wss://rtc;script-src.screenshare.dev",
            "wss://-rtc.screenshare.dev",
        ] {
            let mut config = config();
            let before = serde_json::to_value(&config).unwrap();
            assert!(configure(&mut config, value).is_err(), "{value:?}");
            assert_eq!(serde_json::to_value(config).unwrap(), before);
        }
        assert!(origins(&format!("wss://{}.dev", "a".repeat(2048))).is_err());
        let mut config = config();
        config.app.security.csp = None;
        assert_eq!(
            configure(&mut config, "ws://localhost:7880"),
            Err("missing_media_policy")
        );
    }
}
