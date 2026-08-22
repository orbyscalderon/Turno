import { useAuth } from "./auth";
import { useT, type TKey } from "./i18n";
import { Login } from "./components/Login";
import { ClienteView } from "./components/ClienteView";
import { PeluqueroView } from "./components/PeluqueroView";
import { AdminView } from "./components/AdminView";
import { SuperadminView } from "./components/SuperadminView";
import { ResetPassword } from "./components/ResetPassword";
import { AceptarInvitacion } from "./components/AceptarInvitacion";
import { VerificarEmail } from "./components/VerificarEmail";
import { AccountBar } from "./components/AccountBar";
import { LangToggle } from "./components/LangToggle";
import { Legal } from "./components/Legal";
import { CookieConsent } from "./components/CookieConsent";
import { PublicLanding } from "./components/PublicLanding";
import { Precios } from "./components/Precios";
import { Storefront } from "./components/Storefront";
import { Soluciones } from "./components/Soluciones";
import { VerticalLanding } from "./components/VerticalLanding";
import { COMPANY } from "./company";
import { useEffect, useState } from "react";

// Al llegar desde una landing de rubro, abre el registro con el rubro preseleccionado.
function irARegistro(perfil: string) {
  try { localStorage.setItem("turno_perfil_preferido", perfil); localStorage.setItem("turno_signup", "1"); } catch { /* ignore */ }
  window.location.assign("/");
}

function Footer() {
  return (
    <footer className="container" style={{ textAlign: "center", paddingTop: 30, paddingBottom: 40 }}>
      <div className="faint small">
        <a href="/terminos">Términos</a> · <a href="/privacidad">Privacidad</a> · © {new Date().getFullYear()} Turno
      </div>
      <div className="faint small" style={{ marginTop: 4 }}>
        Operado por <strong>{COMPANY.nombre}</strong> · {COMPANY.direccion}
      </div>
      <div className="faint small">
        {COMPANY.emailSoporte} · {COMPANY.telefono}
      </div>
    </footer>
  );
}

function Header({ children }: { children?: React.ReactNode }) {
  return (
    <header className="app-header">
      <div className="brand">Tur<span>no</span></div>
      {children}
    </header>
  );
}

export default function App() {
  const { usuario, cargando, logout } = useAuth();
  const { t } = useT();
  const path = window.location.pathname;
  // Vista para invitados: "landing" (marketplace público) o "login".
  const [authView, setAuthView] = useState<"landing" | "login">("landing");
  // Si venimos de una landing de rubro, abrimos directo el registro.
  useEffect(() => {
    try { if (localStorage.getItem("turno_signup")) { setAuthView("login"); localStorage.removeItem("turno_signup"); } } catch { /* ignore */ }
  }, []);
  // El superadmin puede alternar entre su panel, gestionar su propio negocio, o ver como cliente.
  const [modoSuper, setModoSuper] = useState<"panel" | "negocio" | "cliente">("panel");

  // Ruta pública: restablecer contraseña con token (/reset/:token).
  const resetMatch = path.match(/^\/reset\/(.+)$/);
  if (resetMatch) {
    return (<><Header /><ResetPassword token={resetMatch[1]} /></>);
  }

  // Ruta pública: verificar email (/verificar/:token).
  const verMatch = path.match(/^\/verificar\/(.+)$/);
  if (verMatch) {
    return (<><Header /><VerificarEmail token={verMatch[1]} /></>);
  }

  // Tienda online pública (/tienda/:slug).
  const tiendaMatch = path.match(/^\/tienda\/(.+)$/);
  if (tiendaMatch) {
    return (<><Header><LangToggle /></Header><Storefront slug={tiendaMatch[1]} /><Footer /></>);
  }

  // Hub de soluciones por rubro y landings por rubro (marketing B2B).
  if (path === "/soluciones") {
    return (<><Header><div className="row"><LangToggle /><button className="primary small" onClick={() => irARegistro("")}>{t("pub.signUp")}</button></div></Header><Soluciones /><Footer /></>);
  }
  const paraMatch = path.match(/^\/para\/(.+)$/);
  if (paraMatch) {
    return (<><Header><div className="row"><LangToggle /><a className="ghost small" href="/soluciones" style={{ padding: "6px 10px" }}>Soluciones</a></div></Header><VerticalLanding slug={paraMatch[1]} onRegistrar={irARegistro} /><Footer /></>);
  }

  // Rutas legales públicas.
  if (path === "/terminos") return (<><Header><LangToggle /></Header><Legal tipo="terminos" /></>);
  if (path === "/privacidad") return (<><Header><LangToggle /></Header><Legal tipo="privacidad" /></>);
  // Página pública de precios.
  if (path === "/precios") return (<><Header><LangToggle /></Header><Precios onRegistrar={() => window.location.assign("/")} /><Footer /></>);

  // Ruta de invitación (/invitacion/:token): requiere login como peluquero.
  const invMatch = path.match(/^\/invitacion\/(.+)$/);

  if (cargando) {
    return <div className="container"><p className="muted">{t("common.loading")}</p></div>;
  }

  if (!usuario) {
    // Invitado: por defecto ve el marketplace público (estilo Fresha); reservar → login.
    if (authView === "login") {
      return (
        <>
          <Header>
            <div className="row">
              <LangToggle />
              <button className="ghost small" onClick={() => setAuthView("landing")}>{t("common.back")}</button>
            </div>
          </Header>
          <Login />
          <Footer /><CookieConsent />
        </>
      );
    }
    return (
      <>
        <Header>
          <div className="row">
            <LangToggle />
            <a className="ghost small" href="/soluciones" style={{ padding: "6px 10px" }}>Soluciones</a>
            <a className="ghost small" href="/precios" style={{ padding: "6px 10px" }}>{t("pub.pricing")}</a>
            <button className="ghost small" onClick={() => setAuthView("login")}>{t("pub.signIn")}</button>
            <button className="primary small" onClick={() => setAuthView("login")}>{t("pub.signUp")}</button>
          </div>
        </Header>
        <PublicLanding onReservar={() => setAuthView("login")} />
        <Footer /><CookieConsent />
      </>
    );
  }

  if (invMatch) {
    return (
      <>
        <Header>
          <div className="row">
            <LangToggle />
            <span className="small muted">{usuario.nombre}</span>
            <button className="ghost small" onClick={logout}>{t("nav.logout")}</button>
          </div>
        </Header>
        <AceptarInvitacion token={invMatch[1]} rol={usuario.rol} />
      </>
    );
  }

  return (
    <>
      <Header>
        <div className="row">
          <LangToggle />
          <span className="badge">{t(`role.${usuario.rol}` as TKey)}</span>
          <span className="small muted">{usuario.nombre}</span>
          {usuario.rol === "superadmin" && (
            <div className="lang-toggle">
              <button className={modoSuper === "panel" ? "on" : ""} onClick={() => setModoSuper("panel")}>{t("nav.modePanel")}</button>
              <button className={modoSuper === "negocio" ? "on" : ""} onClick={() => setModoSuper("negocio")}>{t("nav.modeBusiness")}</button>
              <button className={modoSuper === "cliente" ? "on" : ""} onClick={() => setModoSuper("cliente")}>{t("nav.modeClient")}</button>
            </div>
          )}
          <button className="ghost small" onClick={logout}>{t("nav.logout")}</button>
        </div>
      </Header>

      <AccountBar />

      {usuario.rol === "cliente" && <ClienteView />}
      {usuario.rol === "peluquero" && <PeluqueroView />}
      {usuario.rol === "admin_negocio" && <AdminView />}
      {usuario.rol === "superadmin" && (
        modoSuper === "panel" ? <SuperadminView /> :
        modoSuper === "cliente" ? <ClienteView /> :
        <><AdminView /><PeluqueroView /></>
      )}

      <Footer />
      <CookieConsent />
    </>
  );
}
