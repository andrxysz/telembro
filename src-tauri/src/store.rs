use crate::model::Note;
use serde::{Deserialize, Serialize};
use std::{fs, io::Write, path::PathBuf};

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Saved {
    pub notes: Vec<Note>,
}

pub struct Store {
    pub saved: Saved,
    pub path: PathBuf,
}

impl Store {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let mut saved = if path.exists() {
            let bytes =
                fs::read(&path).map_err(|e| format!("Não foi possível ler seus lembretes: {e}"))?;
            serde_json::from_slice::<Saved>(&bytes).map_err(|e| {
                format!(
                    "O arquivo de lembretes está inválido. Ele foi preservado em {}: {e}",
                    path.display()
                )
            })?
        } else {
            Saved::default()
        };
        let mut ids = std::collections::HashSet::new();
        for note in &mut saved.notes {
            note.draft.validate()?;
            uuid::Uuid::parse_str(&note.id).map_err(|_| "Identificador de lembrete inválido.")?;
            if !ids.insert(note.id.clone()) {
                return Err("Identificador de lembrete duplicado.".into());
            }
            note.alert_until = 0;
        }
        Ok(Self { saved, path })
    }

    pub fn persist(&self) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or("Caminho de armazenamento inválido.")?;
        fs::create_dir_all(parent)
            .map_err(|e| format!("Não foi possível criar a pasta de lembretes: {e}"))?;
        let bytes = serde_json::to_vec_pretty(&self.saved).map_err(|e| e.to_string())?;
        let temp = self.path.with_extension("tmp");
        let mut file =
            fs::File::create(&temp).map_err(|e| format!("Não foi possível salvar: {e}"))?;
        file.write_all(&bytes)
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Não foi possível salvar: {e}"))?;
        drop(file);
        fs::rename(&temp, &self.path)
            .map_err(|e| format!("Não foi possível atualizar os lembretes: {e}"))
    }

    pub fn transact<F>(&mut self, operation: F) -> Result<Vec<Note>, String>
    where
        F: FnOnce(&mut Vec<Note>) -> Result<(), String>,
    {
        let previous = self.saved.clone();
        if let Err(error) = operation(&mut self.saved.notes).and_then(|_| self.persist()) {
            self.saved = previous;
            return Err(error);
        }
        Ok(self.saved.notes.clone())
    }
}
