use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Draft {
    pub text: String,
    pub color: String,
    pub interval_minutes: u32,
    pub repeating: bool,
    pub sound: bool,
    pub duration_seconds: u32,
    pub opacity: f64,
}

impl Draft {
    pub fn validate(&self) -> Result<(), String> {
        if self.text.trim().is_empty() || self.text.encode_utf16().count() > 240 {
            return Err("Escreva uma tarefa com até 240 caracteres.".into());
        }
        if !["lavender", "peach", "mint", "butter"].contains(&self.color.as_str()) {
            return Err("Escolha uma cor válida.".into());
        }
        if !(1..=525600).contains(&self.interval_minutes) {
            return Err("Escolha um intervalo entre 1 minuto e 1 ano.".into());
        }
        if !(3..=30).contains(&self.duration_seconds) {
            return Err("O alerta deve durar entre 3 e 30 segundos.".into());
        }
        if !self.opacity.is_finite() || !(0.25..=0.9).contains(&self.opacity) {
            return Err("Escolha uma visibilidade entre 25% e 90%.".into());
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    #[serde(flatten)]
    pub draft: Draft,
    pub id: String,
    pub created_at: u64,
    pub completed_at: Option<u64>,
    pub locked: bool,
    pub next_alert_at: u64,
    #[serde(default)]
    pub alert_until: u64,
    pub x: Option<i32>,
    pub y: Option<i32>,
}

impl Note {
    pub fn new(mut draft: Draft, now: u64) -> Self {
        draft.text = draft.text.trim().into();
        let next_alert_at = now + u64::from(draft.interval_minutes) * 60_000;
        Self {
            draft,
            id: uuid::Uuid::new_v4().to_string(),
            created_at: now,
            completed_at: None,
            locked: false,
            next_alert_at,
            alert_until: 0,
            x: None,
            y: None,
        }
    }

    pub fn tick(&mut self, now: u64) -> bool {
        if self.completed_at.is_some() {
            return false;
        }
        let mut changed = false;
        if self.alert_until > 0 && self.alert_until <= now {
            self.alert_until = 0;
            changed = true;
        }
        if self.draft.repeating && self.next_alert_at <= now {
            self.alert_until = now + u64::from(self.draft.duration_seconds) * 1000;
            self.next_alert_at = now + u64::from(self.draft.interval_minutes) * 60_000;
            changed = true;
        }
        changed
    }
}

pub fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
