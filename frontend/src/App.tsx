import { useEffect, useState } from "react";
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
import { NegocioPublico } from "./components/NegocioPublico";
import { RetornoPayPal } from "./components/PagoFianza";
import { COMPANY } from "./company";
import { Link, navegar, useRuta } from "./router";
import { ConfigurarDosFactores } from "./components/DosFactores";
import { iniciarAnalitica, evento } from "./analitica";

function Footer() {
  return (
    <footer className="container" style={{ textAlign: "center", paddingTop: 30, paddingBottom: 40 }}>
      <div className="faint small">
        <Link href="/terminos">Términos</Link> · <Link href="/privacidad">Privacidad</Link> · ©{" "}
        {new Date().getFullYear()} Turno
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
      <Link href="/" className="brand" style={{ textDecoration: "none" }}>
        Tur<span>no</span>
      </Link>
      {children}
    </header>
  );
}

// Se arranca una sola vez, fuera del ciclo de React: engancha el vaciado de la
// cola de eventos al cerrar la pestaña.
iniciarAnalitica();

export default function App() {
  const { usuario, cargando, logout, debeActivar2fa } = useAuth();
  const { t } = useT();
  // Ruta reactiva: la navegación interna ya no recarga la aplicación entera.
  const { path } = useRuta();
  // Vista para invitados: "landing" (marketplace público) o "login".
  const [authView, setAuthView] = useState<"landing" | "login">("landing");
  // El superadmin puede alternar entre su panel, gestionar su propio negocio, o ver como cliente.
  const [modoSuper, setModoSuper] = useState<"panel" | "negocio" | "cliente">("panel");
  // El dueño alterna entre la gestión del negocio y su propia ficha de profesional
  // (servicios y horarios): como dueño también es reservable.
  const [modoDueno, setModoDueno] = useState<"negocio" | "profesional">("negocio");
  // Panel de seguridad de la propia cuenta (segundo factor).
  const [verSeguridad, setVerSeguridad] = useState(false);

  // Primera vista de la sesión: el inicio del embudo.
  useEffect(() => {
    evento("landing_vista");
  }, []);

  // --- Rutas públicas que no dependen de la sesión ---
  const resetMatch = path.match(/^\/reset\/(.+)$/);
  if (resetMatch) {
    return (
      <>
        <Header />
        <ResetPassword token={resetMatch[1]} />
      </>
    );
  }

  const verMatch = path.match(/^\/verificar\/(.+)$/);
  if (verMatch) {
    return (
      <>
        <Header />
        <VerificarEmail token={verMatch[1]} />
      </>
    );
  }

  if (path === "/terminos") {
    return (
      <>
        <Header>
          <LangToggle />
        </Header>
        <Legal tipo="terminos" />
      </>
    );
  }
  if (path === "/privacidad") {
    return (
      <>
        <Header>
          <LangToggle />
        </Header>
        <Legal tipo="privacidad" />
      </>
    );
  }
  if (path === "/precios") {
    return (
      <>
        <Header>
          <LangToggle />
        </Header>
        <Precios onRegistrar={() => navegar("/")} />
        <Footer />
      </>
    );
  }

  // Ficha pública de un negocio: URL propia, compartible e indexable.
  const negocioMatch = path.match(/^\/negocio\/([^/]+)$/);
  if (negocioMatch) {
    const irAReservar = () => {
      if (usuario) navegar("/");
      else {
        setAuthView("login");
        navegar("/");
      }
    };
    return (
      <>
        <Header>
          <div className="row">
            <LangToggle />
            {!usuario && (
              <button className="ghost small" onClick={irAReservar}>
                {t("pub.signIn")}
              </button>
            )}
          </div>
        </Header>
        <NegocioPublico slug={decodeURIComponent(negocioMatch[1])} onReservar={irAReservar} />
        <Footer />
        <CookieConsent />
      </>
    );
  }

  // Ruta de invitación (/invitacion/:token): requiere login como peluquero.
  const invMatch = path.match(/^\/invitacion\/(.+)$/);
  // Vuelta de PayPal tras aprobar el pago (/pago/paypal/:reservaId).
  const paypalMatch = path.match(/^\/pago\/paypal\/(\d+)$/);

  if (cargando) {
    return (
      <div className="container">
        <p className="muted">{t("common.loading")}</p>
      </div>
    );
  }

  if (!usuario) {
    // Invitado: por defecto ve el marketplace público; reservar → login.
    if (authView === "login") {
      return (
        <>
          <Header>
            <div className="row">
              <LangToggle />
              <button className="ghost small" onClick={() => setAuthView("landing")}>
                {t("common.back")}
              </button>
            </div>
          </Header>
          <Login />
          <Footer />
          <CookieConsent />
        </>
      );
    }
    return (
      <>
        <Header>
          <div className="row">
            <LangToggle />
            <Link className="ghost small" href="/precios" style={{ padding: "6px 10px" }}>
              {t("pub.pricing")}
            </Link>
            <button className="ghost small" onClick={() => setAuthView("login")}>
              {t("pub.signIn")}
            </button>
            <button className="primary small" onClick={() => setAuthView("login")}>
              {t("pub.signUp")}
            </button>
          </div>
        </Header>
        <PublicLanding onReservar={() => setAuthView("login")} />
        <Footer />
        <CookieConsent />
      </>
    );
  }

  if (paypalMatch) {
    return (
      <>
        <Header />
        <RetornoPayPal reservaId={Number(paypalMatch[1])} />
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
            <button className="ghost small" onClick={logout}>
              {t("nav.logout")}
            </button>
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
              <button className={modoSuper === "panel" ? "on" : ""} onClick={() => setModoSuper("panel")}>
                {t("nav.modePanel")}
              </button>
              <button className={modoSuper === "negocio" ? "on" : ""} onClick={() => setModoSuper("negocio")}>
                {t("nav.modeBusiness")}
              </button>
              <button className={modoSuper === "cliente" ? "on" : ""} onClick={() => setModoSuper("cliente")}>
                {t("nav.modeClient")}
              </button>
            </div>
          )}
          {/* El dueño necesita acceso a SU ficha de profesional: sin esto, un
              negocio de una sola persona no podía tener servicios ni horarios
              y por tanto no era reservable. */}
          {usuario.rol === "admin_negocio" && (
            <div className="lang-toggle">
              <button className={modoDueno === "negocio" ? "on" : ""} onClick={() => setModoDueno("negocio")}>
                {t("nav.modeBusiness")}
              </button>
              <button
                className={modoDueno === "profesional" ? "on" : ""}
                onClick={() => setModoDueno("profesional")}
                title={t("biz.myServicesHelp")}
              >
                {t("biz.myServices")}
              </button>
            </div>
          )}
          <button
            className="ghost small"
            onClick={() => setVerSeguridad((v) => !v)}
            aria-expanded={verSeguridad}
            title={t("twofa.settingsTitle")}
          >
            🔒
          </button>
          <button className="ghost small" onClick={logout}>
            {t("nav.logout")}
          </button>
        </div>
      </Header>

      <AccountBar />

      {/* Un superadmin sin segundo factor no puede usar su panel: el aviso va
          arriba y con el panel de configuración ya abierto. */}
      {debeActivar2fa && (
        <div className="container">
          <ConfigurarDosFactores obligatorio />
        </div>
      )}
      {verSeguridad && !debeActivar2fa && (
        <div className="container">
          <ConfigurarDosFactores />
        </div>
      )}

      {usuario.rol === "cliente" && <ClienteView />}
      {usuario.rol === "peluquero" && <PeluqueroView />}
      {usuario.rol === "admin_negocio" &&
        (modoDueno === "negocio" ? (
          <AdminView />
        ) : (
          <>
            <div className="container">
              <div className="card">
                <h2>{t("biz.myServices")}</h2>
                <p className="muted small">{t("biz.myServicesHelp")}</p>
              </div>
            </div>
            <PeluqueroView />
          </>
        ))}
      {usuario.rol === "superadmin" &&
        (modoSuper === "panel" ? (
          <SuperadminView />
        ) : modoSuper === "cliente" ? (
          <ClienteView />
        ) : (
          <>
            <AdminView />
            <PeluqueroView />
          </>
        ))}

      <Footer />
      <CookieConsent />
    </>
  );
}
