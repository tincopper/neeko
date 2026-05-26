use crate::models::AuthMethod;
use anyhow::Result;
use russh::*;
use std::sync::Arc;

/// SSH client handler that accepts all server keys.
pub struct Client;

impl client::Handler for Client {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh::keys::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

/// Authenticate an existing SSH handle using the provided credentials.
pub async fn authenticate(
    session: &mut client::Handle<Client>,
    username: &str,
    auth: &AuthMethod,
) -> Result<()> {
    let auth_result = match auth {
        AuthMethod::Password(password) => {
            session
                .authenticate_password(username, password.as_str())
                .await?
        }
        AuthMethod::KeyFile(key_path) => {
            let key_pair = russh::keys::load_secret_key(key_path, None)?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
        AuthMethod::KeyFileWithPassphrase {
            key_path,
            passphrase,
        } => {
            let key_pair = russh::keys::load_secret_key(key_path, Some(passphrase.as_str()))?;
            let key_with_hash = russh::keys::PrivateKeyWithHashAlg::new(Arc::new(key_pair), None);
            session
                .authenticate_publickey(username, key_with_hash)
                .await?
        }
    };

    if !auth_result.success() {
        return Err(anyhow::anyhow!("SSH authentication failed"));
    }

    Ok(())
}

/// Connect to an SSH server and authenticate. Returns the authenticated handle.
pub async fn connect_and_authenticate(
    host: &str,
    port: u16,
    username: &str,
    auth: &AuthMethod,
) -> Result<client::Handle<Client>> {
    let config = Arc::new(client::Config::default());
    let mut session = client::connect(config, (host, port), Client).await?;
    authenticate(&mut session, username, auth).await?;
    Ok(session)
}
