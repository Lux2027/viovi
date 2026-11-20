/* Viovi – Einstellungen für Anmelden & Cloud (Supabase).
   Solange die beiden Werte leer sind, läuft Viovi wie bisher ohne Anmeldung.
   Beide Werte findest du im Supabase-Dashboard unter: Project Settings → API.
   (Der "anon / publishable"-Schlüssel ist öffentlich und darf hier stehen –
    NIEMALS den "service_role / secret"-Schlüssel eintragen!) */
window.VIOVI_CONFIG = {
  supabaseUrl: '',
  supabaseKey: '',
};
