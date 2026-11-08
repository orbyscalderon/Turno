import { useEffect, useState } from "react";
import {
  SafeAreaView, View, Text, TextInput, TouchableOpacity, ScrollView,
  StyleSheet, ActivityIndicator, Linking, Alert,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { api, setToken, getToken, ApiError, type Negocio, type Peluquero, type Servicio, type Slot } from "./src/api";

// App móvil de Turno — flujo del cliente (login + reserva). Reutiliza la misma API REST.

export default function App() {
  const [usuario, setUsuario] = useState<{ nombre: string; rol: string } | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    (async () => {
      const t = await getToken();
      if (!t) return setCargando(false);
      try {
        const r = await api.get<{ usuario: { nombre: string; rol: string } }>("/auth/me");
        setUsuario(r.usuario);
      } catch {
        await setToken(null);
      } finally {
        setCargando(false);
      }
    })();
  }, []);

  if (cargando) {
    return <SafeAreaView style={s.center}><ActivityIndicator color="#4f8cff" /></SafeAreaView>;
  }

  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="light" />
      <View style={s.header}>
        <Text style={s.brand}>Tur<Text style={{ color: "#4f8cff" }}>no</Text></Text>
        {usuario && (
          <TouchableOpacity onPress={async () => { await setToken(null); setUsuario(null); }}>
            <Text style={s.link}>Salir</Text>
          </TouchableOpacity>
        )}
      </View>
      {usuario ? <Reserva /> : <Login onLogin={setUsuario} />}
    </SafeAreaView>
  );
}

// La API devuelve sesión, o un desafío de segundo factor si la cuenta lo tiene
// activo. Sin tratar ese caso, la app guardaba un token `undefined` y se quedaba
// en una sesión rota sin decir nada.
interface RespuestaLogin {
  usuario?: { nombre: string; rol: string };
  token?: string;
  requiere2fa?: boolean;
  desafio?: string;
}

function Login({ onLogin }: { onLogin: (u: { nombre: string; rol: string }) => void }) {
  const [email, setEmail] = useState("cliente@turno.app");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Desafío pendiente de 2FA: mientras exista, se pide el código de 6 dígitos.
  const [desafio, setDesafio] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");

  async function aplicar(r: RespuestaLogin) {
    if (r.requiere2fa && r.desafio) {
      setDesafio(r.desafio);
      return;
    }
    if (!r.token || !r.usuario) throw new Error("Respuesta de login inesperada");
    await setToken(r.token);
    onLogin(r.usuario);
  }

  async function entrar() {
    setError(""); setLoading(true);
    try {
      await aplicar(await api.post<RespuestaLogin>("/auth/login", { email, password }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  async function verificar() {
    setError(""); setLoading(true);
    try {
      await aplicar(
        await api.post<RespuestaLogin>("/auth/2fa/verificar", { desafio, codigo: codigo.trim() }),
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error");
      setCodigo("");
    } finally {
      setLoading(false);
    }
  }

  if (desafio) {
    return (
      <ScrollView contentContainerStyle={s.pad}>
        <Text style={s.h1}>Verificación en dos pasos</Text>
        <Text style={s.muted}>
          Introduce el código de 6 dígitos de tu app de autenticación. También vale uno de
          tus códigos de recuperación.
        </Text>
        <Text style={s.label}>Código</Text>
        <TextInput
          style={s.input}
          autoCapitalize="characters"
          keyboardType="number-pad"
          value={codigo}
          onChangeText={setCodigo}
        />
        {error ? <Text style={s.error}>{error}</Text> : null}
        <TouchableOpacity style={s.primary} onPress={verificar} disabled={loading}>
          <Text style={s.primaryTxt}>{loading ? "..." : "Verificar"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { setDesafio(null); setCodigo(""); setError(""); }}>
          <Text style={s.link}>Volver</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.pad}>
      <Text style={s.h1}>Iniciar sesión</Text>
      <Text style={s.label}>Email</Text>
      <TextInput style={s.input} autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
      <Text style={s.label}>Contraseña</Text>
      <TextInput style={s.input} secureTextEntry value={password} onChangeText={setPassword} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <TouchableOpacity style={s.primary} onPress={entrar} disabled={loading}>
        <Text style={s.primaryTxt}>{loading ? "..." : "Entrar"}</Text>
      </TouchableOpacity>
      <Text style={s.muted}>Cuenta demo precargada (cliente@turno.app / password123)</Text>
    </ScrollView>
  );
}

function hoy() { return new Date().toISOString().slice(0, 10); }

function Reserva() {
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [negocio, setNegocio] = useState<Negocio | null>(null);
  const [peluqueros, setPeluqueros] = useState<Peluquero[]>([]);
  const [peluquero, setPeluquero] = useState<Peluquero | null>(null);
  const [servicios, setServicios] = useState<Servicio[]>([]);
  const [servicio, setServicio] = useState<Servicio | null>(null);
  const [fecha, setFecha] = useState(hoy());
  const [slots, setSlots] = useState<Slot[]>([]);
  const [msg, setMsg] = useState("");

  useEffect(() => { api.get<{ negocios: Negocio[] }>("/negocios").then((r) => setNegocios(r.negocios)); }, []);

  async function abrirNegocio(n: Negocio) {
    setNegocio(n); setPeluquero(null); setServicio(null); setSlots([]);
    const r = await api.get<{ peluqueros: Peluquero[] }>(`/negocios/${n.slug}`);
    setPeluqueros(r.peluqueros);
  }
  async function abrirPeluquero(p: Peluquero) {
    setPeluquero(p); setServicio(null); setSlots([]);
    const r = await api.get<{ servicios: Servicio[] }>(`/servicios/peluquero/${p.id}`);
    setServicios(r.servicios);
  }
  async function cargarSlots(sv: Servicio, f: string) {
    if (!peluquero) return;
    const r = await api.get<{ slots: Slot[] }>(`/reservas/slots?peluqueroId=${peluquero.id}&servicioId=${sv.id}&fecha=${f}`);
    setSlots(r.slots);
  }
  function abrirServicio(sv: Servicio) { setServicio(sv); cargarSlots(sv, fecha); }

  async function reservar(slot: Slot) {
    if (!peluquero || !servicio) return;
    try {
      // 1) Crea la reserva: bloquea el hueco y devuelve los datos de cobro.
      //    `pago` es null si la reserva se paga con un bono prepagado: entonces
      //    no hay fianza que cobrar y la cita ya queda confirmada.
      const creada = await api.post<{
        reserva: { id: number };
        pago: { provider: string; clientSecret: string; montoUsd: number } | null;
        bono?: { id: number; usado: boolean };
      }>("/reservas", {
        peluqueroId: peluquero.id, servicioId: servicio.id, fecha, horaInicio: slot.inicio,
      });

      if (!creada.pago) {
        setMsg("¡Reserva confirmada con tu bono! Se ha descontado una sesión.");
        cargarSlots(servicio, fecha);
        return;
      }

      // 2) Cobro de la fianza según la pasarela configurada.
      //    Antes se llamaba al webhook público con `pagado: true`, que era
      //    abusable (cualquiera confirmaba su pago gratis) y hoy el backend lo
      //    rechaza: el pago solo lo sella la pasarela o el endpoint autenticado.
      if (creada.pago.provider === "mock") {
        await api.post(`/reservas/${creada.reserva.id}/pagar`, {});
      } else if (creada.pago.provider === "paypal" && creada.pago.clientSecret) {
        // PayPal se aprueba en el navegador y se captura al volver.
        Linking.openURL(creada.pago.clientSecret).catch(() => {});
        setMsg("Termina el pago en PayPal para confirmar la cita.");
        return;
      } else {
        // Stripe necesita su SDK nativo (@stripe/stripe-react-native) para
        // capturar la tarjeta dentro de la app. Mientras no esté integrado, el
        // hueco queda reservado y el pago se completa desde la web.
        setMsg(
          `Reserva creada por ${creada.pago.montoUsd.toFixed(2)} USD. ` +
            "Termina el pago de la fianza desde la web para confirmarla.",
        );
        return;
      }

      // 3) Recupera la reserva confirmada para obtener el link de WhatsApp.
      const mias = await api.get<{ reservas: { whatsappUrl: string | null }[] }>("/reservas/mias");
      const wa = mias.reservas.find((r) => r.whatsappUrl)?.whatsappUrl;
      setMsg("¡Reserva confirmada!");
      if (wa) Linking.openURL(wa).catch(() => {});
    } catch (e) {
      Alert.alert("No se pudo reservar", e instanceof ApiError ? e.message : "Error");
      if (servicio) cargarSlots(servicio, fecha);
    }
  }

  return (
    <ScrollView contentContainerStyle={s.pad}>
      {msg ? <Text style={s.success}>{msg}</Text> : null}

      {!negocio && (<>
        <Text style={s.h1}>Elige un negocio</Text>
        {negocios.map((n) => (
          <TouchableOpacity key={n.id} style={s.card} onPress={() => abrirNegocio(n)}>
            <Text style={s.cardTitle}>{n.nombreComercial}</Text>
            <Text style={s.muted}>{n.direccion}</Text>
          </TouchableOpacity>
        ))}
      </>)}

      {negocio && !peluquero && (<>
        <Back onPress={() => setNegocio(null)} label={negocio.nombreComercial} />
        <Text style={s.h1}>Elige profesional</Text>
        {peluqueros.map((p) => (
          <TouchableOpacity key={p.id} style={s.card} onPress={() => abrirPeluquero(p)}><Text style={s.cardTitle}>{p.nombre}</Text></TouchableOpacity>
        ))}
      </>)}

      {peluquero && !servicio && (<>
        <Back onPress={() => setPeluquero(null)} label={peluquero.nombre} />
        <Text style={s.h1}>Elige servicio</Text>
        {servicios.map((sv) => (
          <TouchableOpacity key={sv.id} style={s.card} onPress={() => abrirServicio(sv)}>
            <Text style={s.cardTitle}>{sv.nombreServicio}</Text>
            <Text style={s.muted}>${Number(sv.precio).toFixed(2)} · {sv.duracionMinutos} min</Text>
          </TouchableOpacity>
        ))}
      </>)}

      {servicio && (<>
        <Back onPress={() => { setServicio(null); setSlots([]); }} label={servicio.nombreServicio} />
        <Text style={s.label}>Fecha (YYYY-MM-DD)</Text>
        <TextInput style={s.input} value={fecha} onChangeText={(f) => { setFecha(f); if (/^\d{4}-\d{2}-\d{2}$/.test(f)) cargarSlots(servicio, f); }} />
        <Text style={s.h1}>Horarios</Text>
        <View style={s.slots}>
          {slots.length === 0 && <Text style={s.muted}>Sin horarios libres.</Text>}
          {slots.map((sl) => (
            <TouchableOpacity key={sl.inicio} style={s.slot} onPress={() => reservar(sl)}>
              <Text style={s.slotTxt}>{sl.inicio}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={s.muted}>Al tocar un horario se paga la fianza de $2 y se confirma la cita.</Text>
      </>)}
    </ScrollView>
  );
}

function Back({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ marginBottom: 8 }}>
      <Text style={s.link}>← {label}</Text>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0f1115" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#0f1115" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: 16, borderBottomWidth: 1, borderBottomColor: "#2e333d" },
  brand: { color: "#e7e9ee", fontSize: 20, fontWeight: "800" },
  pad: { padding: 16 },
  h1: { color: "#e7e9ee", fontSize: 20, fontWeight: "700", marginVertical: 12 },
  label: { color: "#9aa2b1", fontSize: 13, marginTop: 10, marginBottom: 4 },
  input: { backgroundColor: "#1a1d24", borderColor: "#2e333d", borderWidth: 1, borderRadius: 10, color: "#e7e9ee", padding: 12 },
  primary: { backgroundColor: "#4f8cff", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 16 },
  primaryTxt: { color: "#fff", fontWeight: "700" },
  card: { backgroundColor: "#1a1d24", borderColor: "#2e333d", borderWidth: 1, borderRadius: 12, padding: 16, marginBottom: 10 },
  cardTitle: { color: "#e7e9ee", fontSize: 16, fontWeight: "600" },
  muted: { color: "#9aa2b1", fontSize: 13, marginTop: 4 },
  link: { color: "#4f8cff", fontWeight: "600" },
  error: { color: "#ff5c6c", marginTop: 8 },
  success: { color: "#25d366", marginBottom: 8, fontWeight: "600" },
  slots: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  slot: { backgroundColor: "#232730", borderColor: "#2e333d", borderWidth: 1, borderRadius: 10, paddingVertical: 10, paddingHorizontal: 14 },
  slotTxt: { color: "#e7e9ee", fontVariant: ["tabular-nums"] },
});
