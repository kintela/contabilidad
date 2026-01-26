"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Session } from "@supabase/supabase-js";

type Libro = {
  id: string;
  nombre: string;
  moneda: string | null;
};

type Movimiento = {
  id: string;
  fecha: string;
  tipo: string | null;
  importe: number | null;
  detalle?: string | null;
  fijo?: boolean | null;
  categoria_id?: string | null;
  categoria_nombre?: string | null;
};

const CURRENT_YEAR = new Date().getFullYear();

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [signInLoading, setSignInLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [libros, setLibros] = useState<Libro[]>([]);
  const [librosLoading, setLibrosLoading] = useState(false);
  const [librosError, setLibrosError] = useState<string | null>(null);
  const [selectedLibroId, setSelectedLibroId] = useState<string | null>(null);

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [movimientosLoading, setMovimientosLoading] = useState(false);
  const [movimientosError, setMovimientosError] = useState<string | null>(null);

  const [showIngresosFijos, setShowIngresosFijos] = useState(true);
  const [showIngresosVariables, setShowIngresosVariables] = useState(true);
  const [showGastosFijos, setShowGastosFijos] = useState(true);
  const [showGastosVariables, setShowGastosVariables] = useState(true);
  const [selectedIngresosCategory, setSelectedIngresosCategory] =
    useState("todas");
  const [selectedGastosCategory, setSelectedGastosCategory] =
    useState("todas");

  const todayLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("es-ES", {
        dateStyle: "full",
      }).format(new Date()),
    []
  );

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat("es-ES", {
      year: "numeric",
      month: "short",
      day: "2-digit",
    }).format(new Date(value));

  useEffect(() => {
    let isMounted = true;

    supabase.auth.getSession().then(({ data, error }) => {
      if (!isMounted) return;
      if (error) {
        setAuthError(error.message);
      }
      setSession(data.session ?? null);
      setSessionLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isMounted) return;
        setSession(nextSession);
        setSessionLoading(false);
        setSignInLoading(false);
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (session) return;
    setLibros([]);
    setSelectedLibroId(null);
    setAvailableYears([]);
    setMovimientos([]);
  }, [session]);

  useEffect(() => {
    if (!session?.user?.id) return;

    const loadLibros = async () => {
      setLibrosLoading(true);
      setLibrosError(null);

      const { data: permisos, error: permisosError } = await supabase
        .from("permisos_libro")
        .select("libro_id")
        .eq("usuario_id", session.user.id);

      if (permisosError) {
        setLibrosError(permisosError.message);
        setLibrosLoading(false);
        return;
      }

      const libroIds = (permisos ?? [])
        .map((permiso) => permiso.libro_id)
        .filter(Boolean);

      if (libroIds.length === 0) {
        setLibros([]);
        setSelectedLibroId(null);
        setLibrosLoading(false);
        return;
      }

      const { data: librosData, error: librosError } = await supabase
        .from("libros")
        .select("id, nombre, moneda")
        .in("id", libroIds);

      if (librosError) {
        setLibrosError(librosError.message);
        setLibrosLoading(false);
        return;
      }

      const ordered = [...(librosData ?? [])].sort((a, b) =>
        a.nombre.localeCompare(b.nombre, "es-ES")
      );
      setLibros(ordered);

      const userEmail = session.user.email?.toLowerCase() ?? "";
      const preferredNames =
        userEmail === "roberto.quintela@protonmail.com"
          ? ["personal"]
          : ["comun"];

      const preferredLibro =
        ordered.find((libro) =>
          preferredNames.includes(normalizeText(libro.nombre))
        ) ?? ordered[0];

      setSelectedLibroId(preferredLibro?.id ?? null);
      setLibrosLoading(false);
    };

    loadLibros();
  }, [session]);

  useEffect(() => {
    if (!selectedLibroId) return;

    const loadYears = async () => {
      setMovimientosError(null);
      const { data, error } = await supabase
        .from("movimientos")
        .select("fecha")
        .eq("libro_id", selectedLibroId);

      if (error) {
        setMovimientosError(error.message);
        setAvailableYears([]);
        return;
      }

      const years = Array.from(
        new Set(
          (data ?? [])
            .map((row) => new Date(row.fecha).getFullYear())
            .filter((year) => Number.isFinite(year))
        )
      ).sort((a, b) => b - a);

      setAvailableYears(years);
      setSelectedYear(
        years.includes(CURRENT_YEAR) ? CURRENT_YEAR : years[0] ?? CURRENT_YEAR
      );
    };

    loadYears();
  }, [selectedLibroId]);

  useEffect(() => {
    if (!selectedLibroId || !selectedYear) return;

    const loadMovimientos = async () => {
      setMovimientosLoading(true);
      setMovimientosError(null);

      const start = `${selectedYear}-01-01`;
      const end = `${selectedYear}-12-31`;

      const { data: movimientosData, error } = await supabase
        .from("movimientos")
        .select("id, fecha, tipo, importe, detalle, fijo, categoria_id")
        .eq("libro_id", selectedLibroId)
        .gte("fecha", start)
        .lte("fecha", end);

      if (error) {
        setMovimientosError(error.message);
        setMovimientos([]);
        setMovimientosLoading(false);
        return;
      }

      const categoriaIds = Array.from(
        new Set(
          (movimientosData ?? [])
            .map((mov) => mov.categoria_id)
            .filter(Boolean)
        )
      ) as string[];

      let categoriaMap = new Map<string, string | null>();

      if (categoriaIds.length > 0) {
        const { data: categoriasData, error: categoriasError } = await supabase
          .from("categorias")
          .select("id, nombre")
          .in("id", categoriaIds);

        if (categoriasError) {
          setMovimientosError(categoriasError.message);
        } else {
          categoriasData?.forEach((categoria) => {
            categoriaMap.set(categoria.id, categoria.nombre);
          });
        }
      }

      const enriched = (movimientosData ?? []).map((mov) => ({
        ...mov,
        categoria_nombre: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id) ?? null
          : null,
      }));

      setMovimientos(enriched);
      setMovimientosLoading(false);
    };

    loadMovimientos();
  }, [selectedLibroId, selectedYear]);

  const selectedLibro = libros.find((libro) => libro.id === selectedLibroId);
  const currency = selectedLibro?.moneda ?? "EUR";

  const totals = useMemo(() => {
    let ingresos = 0;
    let gastos = 0;

    movimientos.forEach((mov) => {
      const amount = Number(mov.importe ?? 0);
      const tipo = (mov.tipo ?? "").toLowerCase();

      if (tipo === "ingreso" || tipo === "income") {
        ingresos += Math.abs(amount);
        return;
      }
      if (tipo === "gasto" || tipo === "expense") {
        gastos += Math.abs(amount);
        return;
      }
      if (amount < 0) {
        gastos += Math.abs(amount);
      } else {
        ingresos += Math.abs(amount);
      }
    });

    return {
      ingresos,
      gastos,
      balance: ingresos - gastos,
    };
  }, [movimientos]);

  const movimientoRows = useMemo(() => {
    const withKind = movimientos.map((mov) => {
      const amount = Number(mov.importe ?? 0);
      const tipo = (mov.tipo ?? "").toLowerCase();
      const isIngreso =
        tipo === "ingreso" || tipo === "income"
          ? true
          : tipo === "gasto" || tipo === "expense"
            ? false
            : amount >= 0;

      const categoryName = mov.categoria_nombre ?? "Sin categoría";

      const detailText =
        typeof mov.detalle === "string" && mov.detalle.trim().length > 0
          ? mov.detalle.trim()
          : null;

      return {
        ...mov,
        kind: (isIngreso ? "ingreso" : "gasto") as "ingreso" | "gasto",
        sortValue: Math.abs(amount),
        categoryName,
        detailText,
      };
    });

    const sorted = [...withKind].sort((a, b) => b.sortValue - a.sortValue);

    return {
      ingresos: sorted.filter((mov) => mov.kind === "ingreso"),
      gastos: sorted.filter((mov) => mov.kind === "gasto"),
    };
  }, [movimientos]);

  const filteredIngresos = useMemo(() => {
    return movimientoRows.ingresos.filter((mov) => {
      const isFijo = mov.fijo === true;
      if (isFijo && showIngresosFijos) return true;
      if (!isFijo && showIngresosVariables) return true;
      return false;
    });
  }, [movimientoRows.ingresos, showIngresosFijos, showIngresosVariables]);

  const filteredGastos = useMemo(() => {
    return movimientoRows.gastos.filter((mov) => {
      const isFijo = mov.fijo === true;
      if (isFijo && showGastosFijos) return true;
      if (!isFijo && showGastosVariables) return true;
      return false;
    });
  }, [movimientoRows.gastos, showGastosFijos, showGastosVariables]);

  const ingresoCategories = useMemo(() => {
    return Array.from(
      new Set(filteredIngresos.map((mov) => mov.categoryName))
    ).sort((a, b) => a.localeCompare(b, "es-ES"));
  }, [filteredIngresos]);

  const gastoCategories = useMemo(() => {
    return Array.from(
      new Set(filteredGastos.map((mov) => mov.categoryName))
    ).sort((a, b) => a.localeCompare(b, "es-ES"));
  }, [filteredGastos]);

  useEffect(() => {
    if (
      selectedIngresosCategory !== "todas" &&
      !ingresoCategories.includes(selectedIngresosCategory)
    ) {
      setSelectedIngresosCategory("todas");
    }
  }, [ingresoCategories, selectedIngresosCategory]);

  useEffect(() => {
    if (
      selectedGastosCategory !== "todas" &&
      !gastoCategories.includes(selectedGastosCategory)
    ) {
      setSelectedGastosCategory("todas");
    }
  }, [gastoCategories, selectedGastosCategory]);

  const displayedIngresos = useMemo(() => {
    if (selectedIngresosCategory === "todas") return filteredIngresos;
    return filteredIngresos.filter(
      (mov) => mov.categoryName === selectedIngresosCategory
    );
  }, [filteredIngresos, selectedIngresosCategory]);

  const displayedGastos = useMemo(() => {
    if (selectedGastosCategory === "todas") return filteredGastos;
    return filteredGastos.filter(
      (mov) => mov.categoryName === selectedGastosCategory
    );
  }, [filteredGastos, selectedGastosCategory]);

  const filteredIngresosTotal = useMemo(() => {
    return displayedIngresos.reduce((sum, mov) => {
      return sum + Math.abs(Number(mov.importe ?? 0));
    }, 0);
  }, [displayedIngresos]);

  const filteredGastosTotal = useMemo(() => {
    return displayedGastos.reduce((sum, mov) => {
      return sum + Math.abs(Number(mov.importe ?? 0));
    }, 0);
  }, [displayedGastos]);

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const formatMovementAmount = (mov: {
    importe: number | null;
    kind: "ingreso" | "gasto";
  }) => {
    const amount = Number(mov.importe ?? 0);
    const normalized =
      mov.kind === "gasto" ? -Math.abs(amount) : Math.abs(amount);
    return formatCurrency(normalized);
  };

  const handleSignIn = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError(null);
    setSignInLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setAuthError(error.message);
      setSignInLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[radial-gradient(1200px_circle_at_8%_-10%,rgba(15,118,110,0.2),transparent_60%),radial-gradient(900px_circle_at_110%_10%,rgba(251,146,60,0.2),transparent_55%)]">
      <div className="pointer-events-none absolute -left-24 top-24 h-64 w-64 rounded-full bg-emerald-400/20 blur-[120px]" />
      <div className="pointer-events-none absolute right-8 top-32 h-48 w-48 rounded-full bg-amber-300/30 blur-[100px]" />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10 lg:px-12">
        <header className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <h1
              className="text-4xl font-semibold leading-tight text-[var(--foreground)] sm:text-5xl"
              style={{ fontFamily: "var(--font-fraunces)" }}
            >
              Dashboard
            </h1>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="rounded-full border border-black/10 bg-[var(--surface)] px-4 py-2 text-sm text-[var(--muted)] shadow-sm dark:border-white/10">
              {todayLabel}
            </div>
            {session && !sessionLoading && (
              <>
                <span className="rounded-full border border-black/10 bg-[var(--surface)] px-4 py-2 text-sm text-[var(--foreground)] shadow-sm dark:border-white/10">
                  {session.user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:border-white/10"
                >
                  Cerrar sesión
                </button>
              </>
            )}
          </div>
        </header>

        {!session && !sessionLoading && (
          <div className="mx-auto w-full max-w-md rounded-3xl border border-black/10 bg-[var(--surface)] p-8 shadow-[0_40px_120px_rgba(15,23,42,0.08)] dark:border-white/10">
            <h2
              className="text-2xl font-semibold text-[var(--foreground)]"
              style={{ fontFamily: "var(--font-fraunces)" }}
            >
              Accede a tu libro
            </h2>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Inicia sesión para ver los libros autorizados y sus movimientos.
            </p>

            <form className="mt-6 space-y-4" onSubmit={handleSignIn}>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Email
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@email.com"
                  required
                />
              </label>
              <label className="block text-sm font-medium text-[var(--foreground)]">
                Contraseña
                <input
                  className="mt-2 w-full rounded-2xl border border-black/10 bg-white px-4 py-3 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  required
                />
              </label>
              {authError && (
                <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                  {authError}
                </p>
              )}
              <button
                type="submit"
                className="w-full rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:translate-y-[-1px] hover:bg-[var(--accent-strong)]"
                disabled={signInLoading}
              >
                {signInLoading ? "Entrando..." : "Entrar"}
              </button>
            </form>
          </div>
        )}

        {sessionLoading && (
          <div className="mx-auto w-full max-w-md rounded-3xl border border-black/10 bg-[var(--surface)] p-6 text-center text-sm text-[var(--muted)] shadow-[0_40px_120px_rgba(15,23,42,0.08)] dark:border-white/10">
            Cargando sesión...
          </div>
        )}

        {session && !sessionLoading && (
          <div className="flex flex-1 flex-col gap-8">
            <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
              <div className="rounded-3xl border border-black/10 bg-[var(--surface)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
                <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  Cuenta activa
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <h3
                    className="text-2xl font-semibold text-[var(--foreground)]"
                    style={{ fontFamily: "var(--font-fraunces)" }}
                  >
                    {selectedLibro?.nombre ?? "Selecciona un libro"}
                  </h3>
                  {librosLoading && (
                    <span className="text-sm text-[var(--muted)]">
                      Cargando libros...
                    </span>
                  )}
                  {librosError && (
                    <span className="rounded-full border border-red-500/30 bg-red-500/10 px-3 py-1 text-xs text-red-700 dark:text-red-300">
                      {librosError}
                    </span>
                  )}
                  {!librosLoading &&
                    !librosError &&
                    libros.map((libro) => (
                      <label
                        key={libro.id}
                        className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition ${
                          selectedLibroId === libro.id
                            ? "border-[var(--accent)] bg-emerald-500/10 text-[var(--accent-strong)]"
                            : "border-black/10 bg-white text-[var(--muted)] hover:border-[var(--accent)] dark:border-white/10 dark:bg-black/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name="libro"
                          className="accent-[var(--accent)]"
                          checked={selectedLibroId === libro.id}
                          onChange={() => setSelectedLibroId(libro.id)}
                        />
                        {libro.nombre}
                      </label>
                    ))}
                  <div className="flex items-center gap-2 text-sm text-[var(--muted)]">
                    <span>Año</span>
                    <select
                      className="rounded-full border border-black/10 bg-white px-3 py-2 text-sm text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                      value={selectedYear}
                      onChange={(event) =>
                        setSelectedYear(Number(event.target.value))
                      }
                      disabled={availableYears.length === 0}
                    >
                      {availableYears.length === 0 && (
                        <option value={CURRENT_YEAR}>{CURRENT_YEAR}</option>
                      )}
                      {availableYears.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-black/10 bg-[var(--surface)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
                <div className="flex items-center justify-between gap-3 text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                  <span>Balance</span>
                  <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--foreground)] shadow-sm dark:border-white/10 dark:bg-black/60">
                    {selectedYear}
                  </span>
                </div>
                <p
                  className={`mt-3 text-3xl font-semibold ${
                    totals.balance >= 0
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                  style={{ fontFamily: "var(--font-fraunces)" }}
                >
                  {formatCurrency(totals.balance)}
                </p>
                {movimientosLoading && (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Actualizando datos...
                  </p>
                )}
                {movimientosError && (
                  <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                    {movimientosError}
                  </p>
                )}
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-2">
              <article className="rounded-3xl border border-black/10 bg-[var(--surface)] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      Ingresos
                    </p>
                    <p
                      className="mt-1 text-3xl font-semibold text-[var(--foreground)]"
                      style={{ fontFamily: "var(--font-fraunces)" }}
                    >
                      {formatCurrency(filteredIngresosTotal)}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-col items-start gap-2 text-xs text-[var(--muted)]">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={showIngresosFijos}
                          onChange={(event) =>
                            setShowIngresosFijos(event.target.checked)
                          }
                        />
                        Fijos
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={showIngresosVariables}
                          onChange={(event) =>
                            setShowIngresosVariables(event.target.checked)
                          }
                        />
                        Variables
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedIngresosCategory}
                        onChange={(event) =>
                          setSelectedIngresosCategory(event.target.value)
                        }
                        disabled={ingresoCategories.length === 0}
                      >
                        <option value="todas">Todas</option>
                        {ingresoCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="mt-1 max-h-96 overflow-y-auto rounded-2xl border border-black/5 dark:border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                      <tr className="border-b border-black/5 dark:border-white/10">
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Categoría</th>
                        <th className="px-3 py-2 font-semibold">Detalle</th>
                        <th className="px-3 py-2 font-semibold">Fijo</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Importe
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--foreground)]">
                      {displayedIngresos.length === 0 && (
                        <tr>
                          <td
                            className="px-3 py-3 text-center text-[var(--muted)]"
                            colSpan={5}
                          >
                            Sin movimientos
                          </td>
                        </tr>
                      )}
                      {displayedIngresos.map((mov) => (
                        <tr
                          key={mov.id}
                          className="border-b border-black/5 last:border-b-0 dark:border-white/10"
                        >
                          <td className="px-3 py-2">
                            {formatDate(mov.fecha)}
                          </td>
                          <td className="px-3 py-2">{mov.categoryName}</td>
                          <td className="px-3 py-2">
                            {mov.detailText ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {mov.fijo === true ? "Sí" : "No"}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                            {formatMovementAmount(mov)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

              <article className="rounded-3xl border border-black/10 bg-[var(--surface)] p-4 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col">
                    <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                      Gastos
                    </p>
                    <p
                      className="mt-1 text-3xl font-semibold text-[var(--foreground)]"
                      style={{ fontFamily: "var(--font-fraunces)" }}
                    >
                      {formatCurrency(filteredGastosTotal)}
                    </p>
                  </div>
                  <div className="ml-auto flex flex-col items-start gap-2 text-xs text-[var(--muted)]">
                    <div className="flex flex-wrap items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={showGastosFijos}
                          onChange={(event) =>
                            setShowGastosFijos(event.target.checked)
                          }
                        />
                        Fijos
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={showGastosVariables}
                          onChange={(event) =>
                            setShowGastosVariables(event.target.checked)
                          }
                        />
                        Variables
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedGastosCategory}
                        onChange={(event) =>
                          setSelectedGastosCategory(event.target.value)
                        }
                        disabled={gastoCategories.length === 0}
                      >
                        <option value="todas">Todas</option>
                        {gastoCategories.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
                <div className="mt-1 max-h-96 overflow-y-auto rounded-2xl border border-black/5 dark:border-white/10">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-[var(--surface)] text-[var(--muted)]">
                      <tr className="border-b border-black/5 dark:border-white/10">
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                        <th className="px-3 py-2 font-semibold">Categoría</th>
                        <th className="px-3 py-2 font-semibold">Detalle</th>
                        <th className="px-3 py-2 font-semibold">Fijo</th>
                        <th className="px-3 py-2 text-right font-semibold">
                          Importe
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--foreground)]">
                      {displayedGastos.length === 0 && (
                        <tr>
                          <td
                            className="px-3 py-3 text-center text-[var(--muted)]"
                            colSpan={5}
                          >
                            Sin movimientos
                          </td>
                        </tr>
                      )}
                      {displayedGastos.map((mov) => (
                        <tr
                          key={mov.id}
                          className="border-b border-black/5 last:border-b-0 dark:border-white/10"
                        >
                          <td className="px-3 py-2">
                            {formatDate(mov.fecha)}
                          </td>
                          <td className="px-3 py-2">{mov.categoryName}</td>
                          <td className="px-3 py-2">
                            {mov.detailText ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {mov.fijo === true ? "Sí" : "No"}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold text-rose-600 dark:text-rose-400">
                            {formatMovementAmount(mov)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>

            </section>
          </div>
        )}
      </div>
    </div>
  );
}
