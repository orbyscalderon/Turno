import { useT } from "../i18n";

// Selector de idioma ES/EN en el header.
export function LangToggle() {
  const { lang, setLang } = useT();
  return (
    <div className="lang-toggle" role="group" aria-label="Idioma">
      <button className={lang === "es" ? "on" : ""} onClick={() => setLang("es")}>ES</button>
      <button className={lang === "en" ? "on" : ""} onClick={() => setLang("en")}>EN</button>
    </div>
  );
}
