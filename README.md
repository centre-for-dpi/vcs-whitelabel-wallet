# CDPI Wallet

Billetera móvil de credenciales verificables basada en [Credo-TS](https://github.com/openwallet-foundation/credo-ts) y Expo. Soporta emisión y presentación de credenciales mediante OpenID4VCI / OpenID4VP, comunicación DIDComm vía mediador y autenticación biométrica.

---

## Requisitos previos

| Herramienta | Versión mínima | Notas |
|---|---|---|
| Node.js | 20 LTS | Recomendado |
| npm | 7+ | Incluido con Node 20 |
| Expo CLI | latest | `npm install -g expo-cli` |
| EAS CLI | 12.0+ | `npm install -g eas-cli` (solo para builds) |
| Android Studio | latest | Para emulador Android o compilación nativa |
| Xcode | 15+ | Solo macOS, para iOS |
| Docker & Docker Compose | latest | Solo si se levanta el mediador localmente |

---

## Instalación

```bash
git clone <repo-url>
cd cdpi-wallet
npm install
```

---

## Configuración

Antes de correr la app, editar [branding.config.ts](branding.config.ts) con los valores del entorno de destino:

```ts
// branding.config.ts
export const appName = "CDPI Wallet";

export const colors = {
  primary: "#...",
  secondary: "#...",
  background: "#...",
  text: "#...",
};

// URL del mediador DIDComm (WebSocket)
export const mediatorUrl = "ws://<IP_VPS>:3010/ws";

// Emisores de credenciales soportados
export const issuers = [
  {
    label: "Ministerio del Trabajo",
    url: "http://<IP_VPS>:8091",
    platform: "credebl", // 'inji' | 'credebl' | 'waltid'
  },
];
```

---

## Levantar el mediador DIDComm (opcional pero recomendado para desarrollo)

El mediador permite la comunicación peer-to-peer entre la wallet y los emisores/verificadores.

```bash
cd mediator
docker compose up -d
```

Esto levanta el contenedor `credo-ts-mediator` en el puerto **3010**.  
Configurar `mediatorUrl` en [branding.config.ts](branding.config.ts) apuntando a la IP de la máquina que corre Docker.

---

## Correr la app en desarrollo

### Opción A — Expo Go / Dev Client (recomendado para desarrollo rápido)

```bash
npm start
```

Abre el menú de Expo. Desde aquí se puede:
- Presionar `a` para abrir en emulador Android
- Presionar `i` para abrir en simulador iOS (solo macOS)
- Escanear el QR con la app **Expo Go** en un dispositivo físico

> **Nota:** Credo-TS requiere módulos nativos. Para funcionalidad completa (Askar, cámara, biometría) se necesita un **dev client** (ver abajo), no Expo Go estándar.

### Opción B — Dev Client en emulador/dispositivo

Compilar el dev client una sola vez:

```bash
# Android
npm run android

# iOS (solo macOS)
npm run ios
```

Esto instala la app con todos los módulos nativos. Las iteraciones de JS posteriores no requieren recompilar: solo correr `npm start`.

---

## Builds con EAS

Para generar APK/IPA sin configurar entorno nativo local.

### APK de preview (Android)

```bash
npm run build:android:preview
```

Genera un `.apk` instalable directamente en dispositivos Android.

### Build de producción

```bash
# Android (AAB para Play Store)
npm run build:android:production

# iOS (IPA para App Store)
npm run build:ios:production
```

> Requiere cuenta en [expo.dev](https://expo.dev) y haber ejecutado `eas login`.

---

## Estructura del proyecto

```
cdpi-wallet/
├── app/                   # Rutas de Expo Router
│   ├── index.tsx          # Pantalla inicial
│   ├── onboarding.tsx     # Flujo de primer uso
│   ├── unlock.tsx         # Desbloqueo con biometría/PIN
│   ├── present.tsx        # Presentación de credencial (OpenID4VP)
│   ├── receive.tsx        # Recepción de credencial (OpenID4VCI)
│   └── (tabs)/            # Navegación por pestañas
│       ├── credentials/   # Lista y detalle de credenciales
│       ├── scan.tsx       # Escáner QR
│       └── settings.tsx   # Configuración
├── src/
│   ├── agent/             # Lógica del agente Credo-TS
│   │   ├── setup.ts       # Inicialización del agente
│   │   ├── context.tsx    # React Context del agente
│   │   └── mediator.ts    # Configuración del mediador
│   ├── components/        # Componentes reutilizables
│   └── utils/             # Utilidades (storage, QR, credentials)
├── mediator/
│   └── docker-compose.yml # Mediador DIDComm local
├── branding.config.ts     # Configuración por país/despliegue
├── app.json               # Configuración Expo
├── eas.json               # Perfiles de build EAS
└── metro.config.js        # Bundler (soporte .cjs para Credo-TS)
```

---

## Configuración de deep links

La app responde a los siguientes esquemas URI para integración con emisores y verificadores:

| Esquema | Uso |
|---|---|
| `openid-credential-offer://` | Recibir oferta de credencial (OpenID4VCI) |
| `openid4vp://` | Responder a solicitud de presentación (OpenID4VP) |

Estos están declarados en [app.json](app.json) como `intentFilters` para Android y como URL scheme para iOS.

---

## Troubleshooting

**Error: `Cannot find module '@openwallet-foundation/askar-react-native'`**  
Asegurarse de usar el dev client (no Expo Go) y haber compilado con `npm run android` o `npm run ios`.

**Metro no resuelve paquetes de Credo-TS**  
Verificar que [metro.config.js](metro.config.js) tenga habilitado `resolver.unstable_enablePackageExports: true` y `sourceExts` incluya `cjs`.

**El mediador no conecta**  
Verificar que `mediatorUrl` en [branding.config.ts](branding.config.ts) use la IP de red local (no `localhost`) y que el puerto 3010 esté accesible desde el dispositivo.

**Biometría no funciona en emulador**  
La autenticación biométrica requiere hardware real o un emulador con biometría configurada (Android Studio → Virtual Device → Extended Controls → Fingerprint).
