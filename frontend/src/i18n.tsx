import { createContext, useContext, useState, type ReactNode } from "react";

export type Lang = "es" | "en";

// Diccionario de traducciones. Clave -> { es, en }.
const dict = {
  // Genéricos / navegación
  "brand.tagline": { es: "Reservas para barberías, estética, spa, uñas y cualquier negocio de servicios con cita.", en: "Bookings for barbershops, salons, spas, nails and any appointment-based business." },
  "nav.logout": { es: "Salir", en: "Log out" },
  "nav.viewAsClient": { es: "Ver como cliente", en: "View as client" },
  "nav.backToPanel": { es: "← Volver al panel", en: "← Back to panel" },
  "nav.modePanel": { es: "Panel", en: "Panel" },
  "nav.modeBusiness": { es: "Mi negocio", en: "My business" },
  "nav.modeClient": { es: "Cliente", en: "Client" },
  "map.searchPlaceholder": { es: "Busca una dirección o lugar…", en: "Search an address or place…" },
  "map.search": { es: "Buscar", en: "Search" },
  "map.searching": { es: "Buscando…", en: "Searching…" },
  "map.help": { es: "Haz clic en el mapa o arrastra el pin para fijar la ubicación exacta.", en: "Click the map or drag the pin to set the exact location." },
  "map.notFound": { es: "No se encontró esa dirección. Prueba con otra o coloca el pin a mano.", en: "Address not found. Try another or place the pin manually." },
  "map.searchError": { es: "No se pudo buscar. Coloca el pin en el mapa.", en: "Search failed. Place the pin on the map." },
  "plan.businessesLabel": { es: "negocio(s)", en: "business(es)" },
  "plan.upTo": { es: "Hasta", en: "Up to" },
  "plan.prosLabel": { es: "profesionales por negocio", en: "professionals per business" },
  "common.change": { es: "← Cambiar", en: "← Change" },
  "common.back": { es: "← Volver", en: "← Back" },
  "common.cancel": { es: "Cancelar", en: "Cancel" },
  "common.save": { es: "Guardar", en: "Save" },
  "common.loading": { es: "Cargando...", en: "Loading..." },
  "common.error": { es: "Error", en: "Error" },
  "common.choose": { es: "Elegir", en: "Choose" },
  "common.delete": { es: "Eliminar", en: "Delete" },
  "common.remove": { es: "Quitar", en: "Remove" },
  "common.add": { es: "Agregar", en: "Add" },

  // Roles
  "role.superadmin": { es: "Super Admin", en: "Super Admin" },
  "role.admin_negocio": { es: "Dueño de negocio", en: "Business owner" },
  "role.peluquero": { es: "Profesional", en: "Professional" },
  "role.cliente": { es: "Cliente", en: "Client" },

  // Login
  "login.title": { es: "Iniciar sesión", en: "Sign in" },
  "login.register": { es: "Crear cuenta", en: "Create account" },
  "login.recover": { es: "Recuperar contraseña", en: "Recover password" },
  "login.name": { es: "Nombre", en: "Name" },
  "login.phone": { es: "Teléfono", en: "Phone" },
  "login.registerAs": { es: "Quiero registrarme como", en: "I want to register as" },
  "login.optClient": { es: "Cliente", en: "Client" },
  "login.optPro": { es: "Profesional (barbero, estilista, esteticista...)", en: "Professional (barber, stylist, esthetician...)" },
  "login.optOwner": { es: "Dueño de negocio", en: "Business owner" },
  "login.email": { es: "Email", en: "Email" },
  "login.password": { es: "Contraseña", en: "Password" },
  "login.enter": { es: "Entrar", en: "Sign in" },
  "login.doRegister": { es: "Registrarme", en: "Register" },
  "login.sendLink": { es: "Enviar enlace", en: "Send link" },
  "login.forgot": { es: "¿Olvidaste tu contraseña?", en: "Forgot your password?" },
  "login.haveAccountQ": { es: "¿Ya tienes cuenta?", en: "Already have an account?" },
  "login.noAccountQ": { es: "¿No tienes cuenta?", en: "Don't have an account?" },
  "login.goRegister": { es: "Regístrate", en: "Sign up" },
  "login.goLogin": { es: "Inicia sesión", en: "Sign in" },
  "login.demoAccounts": { es: "Cuentas de prueba", en: "Demo accounts" },

  // Cuenta / verificación / GDPR
  "account.verifyWarn": { es: "⚠️ Verifica tu email para asegurar tu cuenta.", en: "⚠️ Verify your email to secure your account." },
  "account.resend": { es: "Reenviar email", en: "Resend email" },
  "account.my": { es: "Mi cuenta", en: "My account" },
  "account.export": { es: "Exportar mis datos (GDPR)", en: "Export my data (GDPR)" },
  "account.refresh": { es: "Actualizar estado", en: "Refresh status" },
  "account.delete": { es: "Eliminar mi cuenta", en: "Delete my account" },
  "account.deleteConfirm": { es: "¿Eliminar tu cuenta y todos tus datos? Esta acción es irreversible.", en: "Delete your account and all your data? This action is irreversible." },

  // Marketplace (portada del cliente)
  "mkt.heroTitle": { es: "Reserva belleza y bienestar cerca de ti", en: "Book beauty & wellness near you" },
  "mkt.heroSub": { es: "Barberías, peluquerías, estética, uñas, spa y más. Elige, paga la fianza y listo.", en: "Barbershops, salons, spa, nails and more. Pick, pay the deposit and you're set." },
  "mkt.search": { es: "Buscar", en: "Search" },
  "mkt.all": { es: "Todos", en: "All" },
  "mkt.useLocation": { es: "Cerca de ti", en: "Near you" },
  "mkt.locating": { es: "Ubicando...", en: "Locating..." },
  "mkt.near": { es: "Usando tu ubicación", en: "Using your location" },
  "mkt.sortedByDistance": { es: "Ordenado por cercanía", en: "Sorted by distance" },
  "mkt.viewMap": { es: "Ver en mapa", en: "View on map" },
  "pub.signIn": { es: "Iniciar sesión", en: "Sign in" },
  "pub.signUp": { es: "Registrarse", en: "Sign up" },
  "pub.bookCta": { es: "Inicia sesión para reservar", en: "Sign in to book" },
  "pub.services": { es: "Servicios", en: "Services" },
  "pub.team": { es: "Profesionales", en: "Team" },
  "pub.explore": { es: "Explora los mejores sitios cerca de ti", en: "Explore the best places near you" },
  "pub.reviews": { es: "Reseñas", en: "Reviews" },
  "pub.pricing": { es: "Precios", en: "Pricing" },
  "pub.forBusinesses": { es: "Para negocios", en: "For businesses" },
  "pub.pricingTitle": { es: "Haz crecer tu negocio con Turno", en: "Grow your business with Turno" },
  "pub.pricingSub": { es: "Recibe reservas online, cobra la fianza y llena tu agenda.", en: "Get online bookings, collect the deposit and fill your schedule." },
  "pub.registerBiz": { es: "Registra tu negocio", en: "List your business" },
  "common.download": { es: "Descargar CSV", en: "Download CSV" },
  "own.payoutSchedule": { es: "Calendario de depósitos", en: "Payout schedule" },
  "own.payoutSaved": { es: "✓ Calendario actualizado", en: "✓ Schedule updated" },

  // Reset de contraseña
  "reset.title": { es: "Nueva contraseña", en: "New password" },
  "reset.prompt": { es: "Escribe tu nueva contraseña", en: "Enter your new password" },
  "reset.saved": { es: "✓ Contraseña actualizada. Ya puedes iniciar sesión.", en: "✓ Password updated. You can sign in now." },
  "reset.goLogin": { es: "Ir a iniciar sesión", en: "Go to sign in" },

  // Verificación de email
  "verify.title": { es: "Verificación de email", en: "Email verification" },
  "verify.verifying": { es: "Verificando...", en: "Verifying..." },
  "verify.done": { es: "Email verificado correctamente.", en: "Email verified successfully." },
  "verify.goHome": { es: "Ir al inicio", en: "Go home" },

  // Aceptar invitación
  "invite.title": { es: "Invitación a un negocio", en: "Business invitation" },
  "invite.mustPro": { es: "Debes iniciar sesión como profesional para aceptar esta invitación.", en: "You must sign in as a professional to accept this invitation." },
  "invite.invited": { es: "Has sido invitado a unirte a", en: "You've been invited to join" },
  "invite.accept": { es: "Aceptar y unirme", en: "Accept and join" },
  "invite.joined": { es: "✓ Te uniste al negocio. Ya puedes configurar tus servicios y horarios.", en: "✓ You joined the business. You can now set up your services and schedule." },
  "invite.invalid": { es: "Invitación inválida", en: "Invalid invitation" },
  "pub.registerBusiness": { es: "Registra tu negocio", en: "List your business" },
  "mkt.segTreatment": { es: "Todos los servicios", en: "All services" },
  "mkt.segLocation": { es: "Ubicación actual", en: "Current location" },
  "mkt.segWhen": { es: "En cualquier momento", en: "Any time" },
  "mkt.bookedToday": { es: "citas reservadas hoy", en: "appointments booked today" },
  "mkt.statBusinesses": { es: "negocios", en: "businesses" },
  "mkt.statPros": { es: "profesionales", en: "professionals" },
  "mkt.statBookings": { es: "reservas", en: "bookings" },
  "mkt.recommended": { es: "Recomendado", en: "Recommended" },
  "mkt.featured": { es: "Destacado", en: "Featured" },
  "mkt.trust1": { es: "Miles de reservas", en: "Thousands of bookings" },
  "mkt.trust2": { es: "Pago seguro", en: "Secure payment" },
  "mkt.trust3": { es: "Confirmación al instante", en: "Instant confirmation" },
  "mkt.value1t": { es: "Reserva en segundos", en: "Book in seconds" },
  "mkt.value1d": { es: "Elige profesional y horario sin llamadas.", en: "Pick a pro and time, no phone calls." },
  "mkt.value2t": { es: "Pago seguro", en: "Secure payment" },
  "mkt.value2d": { es: "Fianza de $2 para asegurar tu cita.", en: "$2 deposit to secure your appointment." },
  "mkt.value3t": { es: "Recordatorios", en: "Reminders" },
  "mkt.value3d": { es: "Te avisamos por email antes de tu cita.", en: "We remind you by email before your visit." },

  // Cliente - tabs y flujo
  "client.tabBook": { es: "Reservar cita", en: "Book appointment" },
  "client.tabHistory": { es: "Mis reservas", en: "My bookings" },
  "step.business": { es: "1. Negocio", en: "1. Business" },
  "step.professional": { es: "2. Profesional", en: "2. Professional" },
  "step.service": { es: "3. Servicio", en: "3. Service" },
  "step.time": { es: "4. Horario", en: "4. Time" },
  "step.payment": { es: "5. Pago", en: "5. Payment" },
  "client.searchBusiness": { es: "Busca un negocio", en: "Search a business" },
  "client.searchPlaceholder": { es: "Nombre del negocio (barbería, estética, spa...)", en: "Business name (barbershop, salon, spa...)" },
  "client.noBusinesses": { es: "No hay negocios disponibles.", en: "No businesses available." },
  "client.chooseProfessional": { es: "elige profesional", en: "choose a professional" },
  "client.noProfessionals": { es: "Este negocio aún no tiene profesionales activos.", en: "This business has no active professionals yet." },
  "client.chooseService": { es: "elige servicio", en: "choose a service" },
  "client.noServices": { es: "Sin servicios configurados.", en: "No services configured." },
  "client.date": { es: "Fecha", en: "Date" },
  "client.availableSlots": { es: "Horarios disponibles", en: "Available times" },
  "client.noSlots": { es: "No hay horarios libres para esta fecha.", en: "No free times for this date." },
  "client.summary": { es: "Resumen", en: "Summary" },
  "client.with": { es: "con", en: "with" },
  "client.deposit": { es: "Fianza de reserva", en: "Booking deposit" },
  "client.payAndBook": { es: "Pagar y reservar", en: "Pay and book" },
  "client.processing": { es: "Procesando pago...", en: "Processing payment..." },
  "client.depositNote": { es: "El pago de la fianza confirma la cita y bloquea el horario.", en: "The deposit confirms the appointment and blocks the time slot." },
  "client.min": { es: "min", en: "min" },

  // Historial
  "history.empty": { es: "Aún no tienes reservas.", en: "You have no bookings yet." },
  "history.validationCode": { es: "Código de validación", en: "Validation code" },
  "history.whatsapp": { es: "Enviar por WhatsApp", en: "Send via WhatsApp" },
  "history.reschedule": { es: "Reprogramar", en: "Reschedule" },
  "history.review": { es: "Dejar reseña", en: "Leave a review" },
  "history.newDate": { es: "Nueva fecha", en: "New date" },
  "history.reviewComment": { es: "Comentario (opcional)", en: "Comment (optional)" },
  "history.sendReview": { es: "Enviar reseña", en: "Send review" },

  // Profesional
  "pro.tabServices": { es: "Servicios", en: "Services" },
  "pro.tabAvailability": { es: "Disponibilidad", en: "Availability" },
  "pro.tabBlocks": { es: "Bloqueos", en: "Time off" },
  "pro.tabAgenda": { es: "Agenda", en: "Schedule" },
  "pro.tabJoin": { es: "Unirme a negocio", en: "Join a business" },
  "pro.tabProfile": { es: "Perfil", en: "Profile" },
  "pro.tabEarnings": { es: "Ingresos", en: "Earnings" },
  "pro.earningsTitle": { es: "Mis ingresos (este mes)", en: "My earnings (this month)" },
  "pro.earningsHelp": { es: "Desglose de lo que generaste para cuadrar con el negocio a la hora de cobrar.", en: "Breakdown of what you generated, to reconcile with the business at payout time." },
  "pro.paidBookings": { es: "Reservas pagadas", en: "Paid bookings" },
  "pro.generatedForBusiness": { es: "Generado para el negocio (fianzas)", en: "Generated for the business (deposits)" },
  "pro.serviceValue": { es: "Valor de servicios", en: "Service value" },
  "pro.detail": { es: "Detalle de reservas pagadas", en: "Paid bookings detail" },
  "pro.noEarnings": { es: "Aún no tienes reservas pagadas este mes.", en: "No paid bookings this month yet." },
  "pro.allTime": { es: "histórico total", en: "all-time" },

  // Admin
  "admin.createBusiness": { es: "Crear negocio", en: "Create business" },
  "admin.selectBusiness": { es: "Selecciona tu negocio", en: "Select your business" },
  "admin.manage": { es: "Gestionar", en: "Manage" },
  "admin.activeTeam": { es: "Equipo activo", en: "Active team" },
  "admin.pending": { es: "Solicitudes pendientes", en: "Pending requests" },

  // Superadmin
  "sa.platform": { es: "Panel de plataforma", en: "Platform dashboard" },
  "sa.tabSummary": { es: "Resumen y negocios", en: "Summary & businesses" },
  "sa.tabUsers": { es: "Usuarios", en: "Users" },
  "sa.tabIncome": { es: "Ingresos", en: "Income" },
  "sa.tabAudit": { es: "Auditoría", en: "Audit" },
  "sa.businesses": { es: "Negocios", en: "Businesses" },
  "sa.active": { es: "Activos", en: "Active" },
  "sa.paidBookings": { es: "Reservas pagadas", en: "Paid bookings" },
  "sa.depositIncome": { es: "Ingreso por fianzas", en: "Deposit income" },
  "sa.activate": { es: "Activar", en: "Activate" },
  "sa.suspend": { es: "Suspender", en: "Suspend" },
  "sa.searchUser": { es: "Buscar por nombre o email...", en: "Search by name or email..." },
  "sa.verified": { es: "verificado", en: "verified" },
  "sa.unverified": { es: "sin verificar", en: "unverified" },
  "sa.banned": { es: "baneado", en: "banned" },
  "sa.ban": { es: "Banear", en: "Ban" },
  "sa.reactivate": { es: "Reactivar", en: "Reactivate" },
  "sa.incomeTitle": { es: "Ingresos por fianzas (30 días)", en: "Deposit income (30 days)" },
  "sa.total": { es: "Total", en: "Total" },
  "sa.noIncome": { es: "Sin datos de ingresos aún.", en: "No income data yet." },
  "sa.auditTitle": { es: "Registro de auditoría", en: "Audit log" },
  "sa.noAudit": { es: "Sin registros.", en: "No records." },

  // Profesional (panel)
  "pro.newService": { es: "Nuevo servicio", en: "New service" },
  "pro.name": { es: "Nombre", en: "Name" },
  "pro.price": { es: "Precio", en: "Price" },
  "pro.currency": { es: "Moneda", en: "Currency" },
  "pro.duration": { es: "Duración (min)", en: "Duration (min)" },
  "pro.addService": { es: "Agregar servicio", en: "Add service" },
  "pro.myServices": { es: "Mis servicios", en: "My services" },
  "pro.noServices": { es: "Sin servicios.", en: "No services." },
  "pro.weeklyAvail": { es: "Mi disponibilidad semanal", en: "My weekly availability" },
  "pro.availHelp": { es: "Define tus rangos horarios por día. Los clientes solo verán slots dentro de estos rangos.", en: "Set your time ranges per day. Clients only see slots within these ranges." },
  "pro.addRange": { es: "+ Agregar rango", en: "+ Add range" },
  "pro.availSaved": { es: "✓ Disponibilidad guardada", en: "✓ Availability saved" },
  "pro.blockTitle": { es: "Bloquear agenda (descanso / vacaciones)", en: "Block schedule (break / holidays)" },
  "pro.blockHelp": { es: "Los clientes no podrán reservar en el tiempo bloqueado.", en: "Clients can't book during blocked time." },
  "pro.date": { es: "Fecha", en: "Date" },
  "pro.allDay": { es: "Todo el día", en: "All day" },
  "pro.from": { es: "Desde", en: "From" },
  "pro.to": { es: "Hasta", en: "To" },
  "pro.reason": { es: "Motivo (opcional)", en: "Reason (optional)" },
  "pro.addBlock": { es: "Añadir bloqueo", en: "Add block" },
  "pro.upcomingBlocks": { es: "Próximos bloqueos", en: "Upcoming blocks" },
  "pro.noBlocks": { es: "Sin bloqueos.", en: "No blocks." },
  "pro.upcomingAppts": { es: "Próximas citas", en: "Upcoming appointments" },
  "pro.noAppts": { es: "No tienes citas próximas.", en: "You have no upcoming appointments." },
  "pro.requestJoin": { es: "Solicitar unirme a un negocio", en: "Request to join a business" },
  "pro.requestJoinBtn": { es: "Solicitar unirme", en: "Request to join" },
  "pro.requestSent": { es: "Solicitud enviada. Espera la aprobación del dueño.", en: "Request sent. Wait for the owner's approval." },
  "pro.profilePhoto": { es: "Foto de perfil", en: "Profile photo" },
  "pro.serviceImage": { es: "Subir foto del servicio (corte, peinado...)", en: "Upload service photo (cut, style...)" },
  "pro.photoHelp": { es: "Sube tu foto (jpg/png/webp, máx 3MB). La verán los clientes al elegir profesional.", en: "Upload your photo (jpg/png/webp, max 3MB). Clients see it when choosing a professional." },

  // Dueño (panel)
  "own.createBusiness": { es: "Crear negocio", en: "Create business" },
  "own.commercialName": { es: "Nombre comercial", en: "Business name" },
  "own.type": { es: "Tipo de negocio", en: "Business type" },
  "own.address": { es: "Dirección", en: "Address" },
  "own.locationLabel": { es: "Ubicación en el mapa (para que los clientes te encuentren)", en: "Map location (so clients can find you)" },
  "own.useLocation": { es: "Usar mi ubicación actual", en: "Use my current location" },
  "own.useLocationOpt": { es: "Usar mi ubicación actual (opcional)", en: "Use my current location (optional)" },
  "own.locationSet": { es: "Ubicación fijada ✓", en: "Location set ✓" },
  "own.locating": { es: "Ubicando...", en: "Locating..." },
  "own.phone": { es: "Teléfono de contacto", en: "Contact phone" },
  "own.create": { es: "Crear", en: "Create" },
  "own.created": { es: "✓ Negocio creado (14 días de prueba)", en: "✓ Business created (14-day trial)" },
  "own.selectBusiness": { es: "Selecciona tu negocio", en: "Select your business" },
  "own.selectHelp": { es: "Elige el negocio para gestionar su equipo.", en: "Choose the business to manage its team." },
  "own.manage": { es: "Gestionar", en: "Manage" },
  "own.noBusinesses": { es: "Aún no hay negocios. Crea uno arriba.", en: "No businesses yet. Create one above." },
  "own.activeTeam": { es: "Equipo activo", en: "Active team" },
  "own.professionals": { es: "profesionales", en: "professionals" },
  "own.remove": { es: "Quitar", en: "Remove" },
  "own.noActivePros": { es: "Sin profesionales activos.", en: "No active professionals." },
  "own.pendingRequests": { es: "Solicitudes pendientes", en: "Pending requests" },
  "own.accept": { es: "Aceptar", en: "Accept" },
  "own.reject": { es: "Rechazar", en: "Reject" },
  "own.noPending": { es: "No hay solicitudes pendientes.", en: "No pending requests." },
  "own.limitReached": { es: "Alcanzaste el máximo de profesionales. Quita uno para aceptar otro.", en: "You reached the maximum professionals. Remove one to accept another." },
  "own.locationTitle": { es: "Ubicación del negocio", en: "Business location" },
  "own.locationHelp": { es: "Los clientes verán tu dirección y podrán abrirla en el mapa; con coordenadas apareces en \"cerca de ti\".", en: "Clients see your address and can open it on the map; with coordinates you appear in \"near you\"." },
  "own.saveLocation": { es: "Guardar ubicación", en: "Save location" },
  "own.locationSaved": { es: "✓ Ubicación actualizada", en: "✓ Location updated" },
  "own.coverPhoto": { es: "Foto de portada", en: "Cover photo" },
  "own.coverHelp": { es: "La imagen grande que ven los clientes en tu ficha.", en: "The large image clients see on your page." },
  "own.logo": { es: "Logo del negocio", en: "Business logo" },
  "own.logoHelp": { es: "Icono del negocio.", en: "Business icon." },
  "own.inviteTitle": { es: "Invitar profesional por link", en: "Invite professional by link" },
  "own.inviteHelp": { es: "Genera un enlace único (válido 7 días). El profesional lo abre y se une directamente.", en: "Generate a unique link (valid 7 days). The professional opens it and joins directly." },
  "own.inviteGen": { es: "Generar link de invitación", en: "Generate invite link" },
  "own.copy": { es: "Copiar", en: "Copy" },
  "own.subscription": { es: "Suscripción SaaS", en: "SaaS subscription" },
  "own.subStatus": { es: "Estado", en: "Status" },
  "own.subUntil": { es: "hasta", en: "until" },
  "own.monthly": { es: "Mensual", en: "Monthly" },
  "own.annual": { es: "Anual", en: "Annual" },
  "own.daily": { es: "Diario", en: "Daily" },
  "own.weekly": { es: "Semanal", en: "Weekly" },
  "own.perMonth": { es: "/mes", en: "/mo" },
  "own.perYear": { es: "/año", en: "/yr" },
  "own.annualBilled": { es: "facturado anual", en: "billed yearly" },
  "own.save2months": { es: "2 meses gratis", en: "2 months free" },
  "own.choosePlan": { es: "Elegir plan", en: "Choose plan" },
  "own.currentPlan": { es: "Plan actual", en: "Current plan" },
  "own.payouts": { es: "Recibir tus cobros", en: "Receive your payouts" },
  "own.payoutsHelp": { es: "Conecta tu cuenta para recibir tu parte de la fianza de cada reserva (la plataforma retiene una pequeña comisión).", en: "Connect your account to receive your share of each booking deposit (the platform keeps a small fee)." },
  "own.payoutsConnect": { es: "Conectar cobros", en: "Connect payouts" },
  "own.payoutsActive": { es: "✓ Cobros activos", en: "✓ Payouts active" },
  "own.payoutsPending": { es: "Onboarding pendiente — pulsa para completar", en: "Onboarding pending — click to finish" },
  "own.splitTitle": { es: "Reparto de cada fianza", en: "How each deposit is split" },
  "own.splitBusiness": { es: "Tu negocio", en: "Your business" },
  "own.splitPlatform": { es: "Turno", en: "Turno" },
  "own.splitStripe": { es: "Comisión Stripe", en: "Stripe fee" },
  "own.settlement": { es: "Liquidación por empleado (este mes)", en: "Settlement by employee (this month)" },
  "own.settlementHelp": { es: "La fianza va a tu cuenta; aquí ves cuánto generó cada empleado para que le pagues su parte.", en: "Deposits go to your account; here you see how much each employee generated to pay them their share." },
  "own.employee": { es: "Empleado", en: "Employee" },
  "own.bookings": { es: "Reservas", en: "Bookings" },
  "own.forBusiness": { es: "Para el negocio", en: "For the business" },
  "own.noSettlement": { es: "Aún no hay reservas pagadas este mes.", en: "No paid bookings this month yet." },
  "own.analytics": { es: "Analítica del negocio", en: "Business analytics" },
  "own.totalBookings": { es: "Reservas totales", en: "Total bookings" },
  "own.incomeCompleted": { es: "Ingresos (completadas)", en: "Income (completed)" },
  "own.bookingsByPro": { es: "Reservas por profesional", en: "Bookings by professional" },
} as const;

export type TKey = keyof typeof dict;

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey) => string;
}

const I18nContext = createContext<I18nState | null>(null);
const LANG_KEY = "turno_lang";

function detectarIdioma(): Lang {
  const guardado = localStorage.getItem(LANG_KEY) as Lang | null;
  if (guardado === "es" || guardado === "en") return guardado;
  return navigator.language?.toLowerCase().startsWith("en") ? "en" : "es";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detectarIdioma);

  function setLang(l: Lang) {
    localStorage.setItem(LANG_KEY, l);
    setLangState(l);
  }
  function t(key: TKey): string {
    return dict[key]?.[lang] ?? key;
  }

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useT() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT debe usarse dentro de I18nProvider");
  return ctx;
}
