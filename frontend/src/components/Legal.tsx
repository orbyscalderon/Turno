import { useT } from "../i18n";
import { COMPANY } from "../company";

// Páginas legales (Términos y Privacidad), bilingües y con los datos de la empresa (COMPANY).
// Nota: plantilla de partida; revísala con un abogado antes de producción real.

export function Legal({ tipo }: { tipo: "terminos" | "privacidad" }) {
  const { lang } = useT();
  const es = lang === "es";
  return (
    <div className="container" style={{ maxWidth: 760 }}>
      <p><a href="/">← {es ? "Volver" : "Back"}</a></p>
      <div className="card">
        {tipo === "terminos" ? (es ? <TerminosES /> : <TerminosEN />) : (es ? <PrivacidadES /> : <PrivacidadEN />)}
        <DatosEmpresa es={es} />
        <p className="faint small" style={{ marginTop: 12 }}>
          {es
            ? "Documento de ejemplo. Sustitúyelo por tus términos definitivos revisados legalmente."
            : "Sample document. Replace with your legally reviewed final terms."}
        </p>
      </div>
    </div>
  );
}

// Bloque común con los datos de la empresa operadora.
function DatosEmpresa({ es }: { es: boolean }) {
  return (
    <div className="card" style={{ background: "var(--surface-2)", marginTop: 16, marginBottom: 0 }}>
      <h3>{es ? "Empresa operadora" : "Operating company"}</h3>
      <p className="small" style={{ margin: 0 }}>
        <strong>{COMPANY.nombre}</strong><br />
        {COMPANY.direccion}<br />
        {COMPANY.pais} · {COMPANY.registro}<br />
        {es ? "Soporte" : "Support"}: {COMPANY.emailSoporte} · {es ? "Legal" : "Legal"}: {COMPANY.emailLegal}<br />
        {es ? "Privacidad" : "Privacy"}: {COMPANY.emailPrivacidad} · {COMPANY.telefono}
      </p>
    </div>
  );
}

function TerminosES() {
  return (
    <>
      <h1>Términos y Condiciones</h1>
      <p className="muted small">Última actualización: 2026 · Operado por {COMPANY.nombre}</p>
      <h3>1. Objeto</h3>
      <p>Turno es una plataforma operada por <strong>{COMPANY.nombre}</strong> que conecta a clientes con negocios de servicios (barberías, peluquerías, estética, spa, etc.) para reservar citas.</p>
      <h3>2. Reservas y fianza</h3>
      <p>Al reservar, el cliente paga una fianza de 2 USD que confirma la cita. La cancelación con al menos 24 horas de antelación da derecho a reembolso de la fianza; después no.</p>
      <h3>3. Cuentas</h3>
      <p>Eres responsable de mantener la confidencialidad de tu cuenta. Los negocios son responsables de la veracidad de sus datos, servicios y disponibilidad.</p>
      <h3>4. Pagos</h3>
      <p>Los pagos se procesan a través de pasarelas externas (p. ej. Stripe). El pago del servicio en el local es responsabilidad del negocio y el cliente.</p>
      <h3>5. Responsabilidad</h3>
      <p>Turno actúa como intermediario tecnológico y no presta directamente los servicios de belleza. No nos hacemos responsables de la calidad del servicio prestado por los negocios.</p>
      <h3>6. Contacto</h3>
      <p>Para cualquier consulta, escribe a {COMPANY.emailSoporte}. Responsable: {COMPANY.nombre}.</p>
    </>
  );
}
function TerminosEN() {
  return (
    <>
      <h1>Terms & Conditions</h1>
      <p className="muted small">Last updated: 2026 · Operated by {COMPANY.nombre}</p>
      <h3>1. Purpose</h3>
      <p>Turno is a platform operated by <strong>{COMPANY.nombre}</strong> that connects clients with service businesses (barbershops, salons, spas, etc.) to book appointments.</p>
      <h3>2. Bookings and deposit</h3>
      <p>When booking, the client pays a 2 USD deposit that confirms the appointment. Cancelling at least 24 hours in advance grants a refund of the deposit; afterwards it does not.</p>
      <h3>3. Accounts</h3>
      <p>You are responsible for keeping your account confidential. Businesses are responsible for the accuracy of their data, services and availability.</p>
      <h3>4. Payments</h3>
      <p>Payments are processed through external gateways (e.g. Stripe). Paying for the service on-site is the responsibility of the business and client.</p>
      <h3>5. Liability</h3>
      <p>Turno acts as a technology intermediary and does not directly provide beauty services. We are not liable for the quality of services provided by businesses.</p>
      <h3>6. Contact</h3>
      <p>For any questions, email {COMPANY.emailSoporte}. Controller: {COMPANY.nombre}.</p>
    </>
  );
}
function PrivacidadES() {
  return (
    <>
      <h1>Política de Privacidad</h1>
      <p className="muted small">Última actualización: 2026 · Responsable: {COMPANY.nombre}</p>
      <p>El responsable del tratamiento de tus datos es <strong>{COMPANY.nombre}</strong> ({COMPANY.direccion}).</p>
      <h3>1. Datos que recogemos</h3>
      <p>Nombre, email, teléfono, historial de reservas y, si lo autorizas, tu ubicación aproximada para mostrarte negocios cercanos.</p>
      <h3>2. Uso de los datos</h3>
      <p>Usamos tus datos para gestionar reservas, enviar confirmaciones y recordatorios, y mejorar el servicio. No vendemos tus datos a terceros.</p>
      <h3>3. Tus derechos (RGPD)</h3>
      <p>Puedes exportar todos tus datos y eliminar tu cuenta en cualquier momento desde "Mi cuenta". También puedes solicitar rectificación escribiendo a {COMPANY.emailPrivacidad}.</p>
      <h3>4. Cookies</h3>
      <p>Usamos almacenamiento local para tu sesión e idioma. No usamos cookies de seguimiento publicitario.</p>
      <h3>5. Seguridad</h3>
      <p>Las contraseñas se guardan cifradas (hash) y la comunicación viaja sobre HTTPS en producción.</p>
    </>
  );
}
function PrivacidadEN() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="muted small">Last updated: 2026 · Data controller: {COMPANY.nombre}</p>
      <p>The data controller is <strong>{COMPANY.nombre}</strong> ({COMPANY.direccion}).</p>
      <h3>1. Data we collect</h3>
      <p>Name, email, phone, booking history and, if you allow it, your approximate location to show nearby businesses.</p>
      <h3>2. Use of data</h3>
      <p>We use your data to manage bookings, send confirmations and reminders, and improve the service. We do not sell your data to third parties.</p>
      <h3>3. Your rights (GDPR)</h3>
      <p>You can export all your data and delete your account any time from "My account". You can also request rectification by emailing {COMPANY.emailPrivacidad}.</p>
      <h3>4. Cookies</h3>
      <p>We use local storage for your session and language. We do not use advertising tracking cookies.</p>
      <h3>5. Security</h3>
      <p>Passwords are stored hashed and communication travels over HTTPS in production.</p>
    </>
  );
}
