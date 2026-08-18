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

function Login({ onLogin }: { onLogin: (u: { nombre: string; rol: string }) => void }) {
  const [email, setEmail] = useState("cliente@turno.app");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function entrar() {
    setError(""); setLoading(true);
    try {
      const r = await api.post<{ usuario: { nombre: string; rol: string }; token: string }>("/auth/login", { email, password });
      await setToken(r.token);
      onLogin(r.usuario);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Error");
    } finally {
      setLoading(false);
    }
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
      const creada = await api.post<{ pago: { transaccionId: string } }>("/reservas", {
        peluqueroId: peluquero.id, servicioId: servicio.id, fecha, horaInicio: slot.inicio,
      });
      await api.post("/reservas/webhook/pago", { transaccionId: creada.pago.transaccionId, pagado: true });
      // Recupera la reserva confirmada para obtener el link de WhatsApp.
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
