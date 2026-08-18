# Turno — App móvil (Expo)

Cliente móvil del flujo de reserva, construido con **Expo + React Native + TypeScript**.
Reutiliza la misma API REST que la web (`backend/`).

## Requisitos
- Node 18+
- App **Expo Go** en tu teléfono, o un emulador Android/iOS.

## Arranque
```bash
cd mobile
npm install
npx expo start        # escanea el QR con Expo Go
```

## Configurar la URL de la API
Por defecto apunta a `http://localhost:4000` (ver `app.json` → `extra.apiUrl`). En un
dispositivo físico o emulador, `localhost` NO es tu PC:
- **Emulador Android:** usa `http://10.0.2.2:4000`.
- **Dispositivo real:** usa la IP de tu PC en la LAN, p. ej. `http://192.168.1.50:4000`
  (y arranca el backend con esa red accesible).

Edita `app.json`:
```json
"extra": { "apiUrl": "http://10.0.2.2:4000" }
```

## Alcance de este scaffold
Incluye login y el **flujo completo del cliente** (negocio → barbero → servicio → fecha →
slots → pago mock → apertura del deep link de WhatsApp). Los paneles de peluquero/admin/
superadmin viven en la web. Selección de fecha con campo de texto (YYYY-MM-DD) para
mantener el scaffold sin dependencias extra; se puede sustituir por `@react-native-community/datetimepicker`.

> Nota: este paquete no se compiló en el entorno de desarrollo original (requiere Expo y un
> emulador/dispositivo). El código está tipado y estructurado para `npx expo start`.
