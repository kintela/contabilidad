"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
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
  categoria_kind?: string | null;
};

type SortKey = "fecha" | "categoria" | "detalle" | "fijo" | "importe";
type SortDirection = "asc" | "desc";
type SortState = { key: SortKey; direction: SortDirection };

const CURRENT_YEAR = new Date().getFullYear();

const normalizeText = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const normalizeKindLabel = (value?: string | null) => {
  const tipo = (value ?? "").toLowerCase().trim();
  if (!tipo) return null;
  if (
    tipo.includes("ingres") ||
    tipo.includes("income") ||
    tipo.includes("entrada") ||
    tipo.includes("abono")
  ) {
    return "ingreso" as const;
  }
  if (
    tipo.includes("gast") ||
    tipo.includes("expense") ||
    tipo.includes("salida") ||
    tipo.includes("cargo")
  ) {
    return "gasto" as const;
  }
  if (tipo === "i") return "ingreso" as const;
  if (tipo === "g") return "gasto" as const;
  return null;
};

const resolveCategoryKind = (categoria: Record<string, unknown>) => {
  const tipo = typeof categoria.tipo === "string" ? categoria.tipo : null;
  const kindFromTipo = normalizeKindLabel(tipo);
  if (kindFromTipo) return kindFromTipo;
  for (const [key, value] of Object.entries(categoria)) {
    if (typeof value !== "string") continue;
    const keyLower = key.toLowerCase();
    if (
      keyLower.includes("tipo") ||
      keyLower.includes("kind") ||
      keyLower.includes("mov")
    ) {
      const kind = normalizeKindLabel(value);
      if (kind) return kind;
    }
  }
  const esGasto =
    typeof categoria.es_gasto === "boolean"
      ? categoria.es_gasto
      : typeof categoria.esGasto === "boolean"
        ? categoria.esGasto
        : typeof categoria.gasto === "boolean"
          ? categoria.gasto
          : null;
  if (typeof esGasto === "boolean") return esGasto ? "gasto" : "ingreso";
  const esIngreso =
    typeof categoria.es_ingreso === "boolean"
      ? categoria.es_ingreso
      : typeof categoria.esIngreso === "boolean"
        ? categoria.esIngreso
        : typeof categoria.ingreso === "boolean"
          ? categoria.ingreso
          : null;
  if (typeof esIngreso === "boolean") return esIngreso ? "ingreso" : "gasto";
  for (const [key, value] of Object.entries(categoria)) {
    if (typeof value !== "boolean") continue;
    const keyLower = key.toLowerCase();
    if (keyLower.includes("gasto")) return value ? "gasto" : "ingreso";
    if (keyLower.includes("ingreso")) return value ? "ingreso" : "gasto";
  }
  return null;
};

const resolveKind = (mov: {
  tipo?: string | null;
  importe?: number | null;
  categoria_kind?: string | null;
}) => {
  const tipoKind = normalizeKindLabel(mov.tipo);
  if (tipoKind) return tipoKind;
  const categoryKind = normalizeKindLabel(mov.categoria_kind);
  if (categoryKind) return categoryKind;
  const amount = Number(mov.importe ?? 0);
  return amount < 0 ? "gasto" : "ingreso";
};

const SortArrow = ({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) => (
  <svg
    className={`h-2 w-2 ${
      active
        ? "text-[var(--accent)]"
        : "text-black/30 dark:text-white/30"
    } ${active && direction === "asc" ? "rotate-180" : ""}`}
    viewBox="0 0 10 6"
    aria-hidden="true"
  >
    <path d="M0 0h10L5 6z" fill="currentColor" />
  </svg>
);

const GroupToggle = ({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) => (
  <button
    type="button"
    title="agrupar"
    onClick={onClick}
    className={`flex h-4 w-4 items-center justify-center rounded-sm border border-transparent transition ${
      active
        ? "text-[var(--accent)]"
        : "text-black/30 hover:text-black/60 dark:text-white/30 dark:hover:text-white/60"
    }`}
  >
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true">
      <rect x="1" y="1" width="4" height="4" fill="currentColor" />
      <rect x="7" y="1" width="4" height="4" fill="currentColor" />
      <rect x="1" y="7" width="4" height="4" fill="currentColor" />
      <rect x="7" y="7" width="4" height="4" fill="currentColor" />
    </svg>
  </button>
);

export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [signInLoading, setSignInLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [libros, setLibros] = useState<Libro[]>([]);
  const [librosLoading, setLibrosLoading] = useState(false);
  const [librosError, setLibrosError] = useState<string | null>(null);
  const [selectedLibroId, setSelectedLibroId] = useState<string | null>(null);

  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number>(CURRENT_YEAR);
  const [movimientos, setMovimientos] = useState<Movimiento[]>([]);
  const [movimientosLoading, setMovimientosLoading] = useState(false);
  const [movimientosError, setMovimientosError] = useState<string | null>(null);
  const [yearlyMovimientos, setYearlyMovimientos] = useState<Movimiento[]>([]);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState<string | null>(null);

  const [showIngresosFijos, setShowIngresosFijos] = useState(true);
  const [showIngresosVariables, setShowIngresosVariables] = useState(true);
  const [showGastosFijos, setShowGastosFijos] = useState(true);
  const [showGastosVariables, setShowGastosVariables] = useState(true);
  const [showChartFijos, setShowChartFijos] = useState(true);
  const [showChartVariables, setShowChartVariables] = useState(true);
  const [showYearlyIngresos, setShowYearlyIngresos] = useState(true);
  const [showYearlyGastos, setShowYearlyGastos] = useState(true);
  const [showYearlyFijos, setShowYearlyFijos] = useState(true);
  const [showYearlyVariables, setShowYearlyVariables] = useState(false);
  const [selectedYearlyYear, setSelectedYearlyYear] = useState("todos");
  const [selectedYearlyCategory, setSelectedYearlyCategory] =
    useState("todas");
  const [selectedYearlyDetail, setSelectedYearlyDetail] = useState("todos");
  const [searchIngresos, setSearchIngresos] = useState("");
  const [searchGastos, setSearchGastos] = useState("");
  const [groupIngresosByCategory, setGroupIngresosByCategory] = useState(true);
  const [groupIngresosByDetail, setGroupIngresosByDetail] = useState(true);
  const [groupGastosByCategory, setGroupGastosByCategory] = useState(true);
  const [groupGastosByDetail, setGroupGastosByDetail] = useState(true);
  const [sortIngresos, setSortIngresos] = useState<SortState>({
    key: "importe",
    direction: "desc",
  });
  const [sortGastos, setSortGastos] = useState<SortState>({
    key: "importe",
    direction: "desc",
  });
  const [selectedSegment, setSelectedSegment] = useState<{
    kind: "ingreso" | "gasto";
    fijo: boolean;
    category: string;
  } | null>(null);
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
      const nextSession = data.session ?? null;
      setSession(nextSession);
      if (!nextSession) {
        setLibros([]);
        setSelectedLibroId(null);
        setAvailableYears([]);
        setMovimientos([]);
        setYearlyMovimientos([]);
        setYearlyError(null);
      }
      setSessionLoading(false);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        if (!isMounted) return;
        setSession(nextSession);
        setSessionLoading(false);
        setSignInLoading(false);
        if (!nextSession) {
          setLibros([]);
          setSelectedLibroId(null);
          setAvailableYears([]);
          setMovimientos([]);
          setYearlyMovimientos([]);
          setYearlyError(null);
        }
      }
    );

    return () => {
      isMounted = false;
      authListener.subscription?.unsubscribe();
    };
  }, []);

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
      const pageSize = 500;
      let from = 0;
      const allRows: { fecha: string }[] = [];
      let totalCount: number | null = null;

      while (true) {
        const { data, error, count } = await supabase
          .from("movimientos")
          .select("fecha", { count: "exact" })
          .eq("libro_id", selectedLibroId)
          .range(from, from + pageSize - 1);

        if (error) {
          setMovimientosError(error.message);
          setAvailableYears([]);
          return;
        }

        if (totalCount === null && typeof count === "number") {
          totalCount = count;
        }

        if (data && data.length > 0) {
          allRows.push(...data);
        }

        if (!data || data.length === 0) break;
        from += pageSize;

        if (totalCount !== null && allRows.length >= totalCount) break;
        if (data.length < pageSize && totalCount === null) break;
      }

      const years = Array.from(
        new Set(
          allRows
            .map((row) => {
              if (typeof row.fecha === "string") {
                const rawYear = Number(row.fecha.slice(0, 4));
                return Number.isFinite(rawYear)
                  ? rawYear
                  : new Date(row.fecha).getFullYear();
              }
              return new Date(row.fecha).getFullYear();
            })
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

      const categoriaMap = new Map<
        string,
        { nombre: string | null; kind: "ingreso" | "gasto" | null }
      >();

      if (categoriaIds.length > 0) {
        const { data: categoriasData, error: categoriasError } = await supabase
          .from("categorias")
          .select("*")
          .in("id", categoriaIds);

        if (categoriasError) {
          setMovimientosError(categoriasError.message);
        } else {
          categoriasData?.forEach((categoria) => {
            categoriaMap.set(categoria.id, {
              nombre: categoria.nombre ?? null,
              kind: resolveCategoryKind(categoria as Record<string, unknown>),
            });
          });
        }
      }

      const enriched = (movimientosData ?? []).map((mov) => ({
        ...mov,
        categoria_nombre: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.nombre ?? null
          : null,
        categoria_kind: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.kind ?? null
          : null,
      }));

      setMovimientos(enriched);
      setMovimientosLoading(false);
    };

    loadMovimientos();
  }, [selectedLibroId, selectedYear]);

  useEffect(() => {
    if (!selectedLibroId) return;

    const loadYearlyMovimientos = async () => {
      setYearlyLoading(true);
      setYearlyError(null);

      const pageSize = 500;
      let from = 0;
      const allRows: Movimiento[] = [];

      while (true) {
        const { data, error } = await supabase
          .from("movimientos")
          .select("id, fecha, tipo, importe, fijo, categoria_id, detalle")
          .eq("libro_id", selectedLibroId)
          .range(from, from + pageSize - 1);

        if (error) {
          setYearlyError(error.message);
          setYearlyMovimientos([]);
          setYearlyLoading(false);
          return;
        }

        if (!data || data.length === 0) break;
        allRows.push(...data);

        if (data.length < pageSize) break;
        from += pageSize;
      }

      const categoriaIds = Array.from(
        new Set(allRows.map((mov) => mov.categoria_id).filter(Boolean))
      ) as string[];

      const categoriaMap = new Map<
        string,
        { nombre: string | null; kind: "ingreso" | "gasto" | null }
      >();

      if (categoriaIds.length > 0) {
        const { data: categoriasData, error: categoriasError } = await supabase
          .from("categorias")
          .select("*")
          .in("id", categoriaIds);

        if (categoriasError) {
          setYearlyError(categoriasError.message);
        } else {
          categoriasData?.forEach((categoria) => {
            categoriaMap.set(categoria.id, {
              nombre: categoria.nombre ?? null,
              kind: resolveCategoryKind(categoria as Record<string, unknown>),
            });
          });
        }
      }

      const enriched = allRows.map((mov) => ({
        ...mov,
        categoria_nombre: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.nombre ?? null
          : null,
        categoria_kind: mov.categoria_id
          ? categoriaMap.get(mov.categoria_id)?.kind ?? null
          : null,
      }));

      setYearlyMovimientos(enriched);
      setYearlyLoading(false);
    };

    loadYearlyMovimientos();
  }, [selectedLibroId]);

  const selectedLibro = libros.find((libro) => libro.id === selectedLibroId);
  const currency = selectedLibro?.moneda ?? "EUR";

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

  const formatShortCurrency = (value: number) => {
    const abs = Math.abs(value);
    const baseFormatter = new Intl.NumberFormat("es-ES", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    });
    if (abs >= 1_000_000) {
      return `${baseFormatter.format(value / 1_000_000)} M €`;
    }
    if (abs >= 1_000) {
      return `${baseFormatter.format(value / 1_000)} k €`;
    }
    return formatCurrency(value);
  };

  const totals = useMemo(() => {
    let ingresos = 0;
    let gastos = 0;

    movimientos.forEach((mov) => {
      const amount = Math.abs(Number(mov.importe ?? 0));
      if (!Number.isFinite(amount) || amount === 0) return;
      const kind = resolveKind(mov);
      if (kind === "ingreso") {
        ingresos += amount;
      } else {
        gastos += amount;
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
      const kind = resolveKind(mov);

      const categoryName = mov.categoria_nombre ?? "Sin categoría";

      const detailText =
        typeof mov.detalle === "string" && mov.detalle.trim().length > 0
          ? mov.detalle.trim()
          : null;

      return {
        ...mov,
        kind,
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

  const safeSelectedIngresosCategory =
    selectedIngresosCategory === "todas" ||
    ingresoCategories.includes(selectedIngresosCategory)
      ? selectedIngresosCategory
      : "todas";

  const safeSelectedGastosCategory =
    selectedGastosCategory === "todas" ||
    gastoCategories.includes(selectedGastosCategory)
      ? selectedGastosCategory
      : "todas";

  const displayedIngresos = useMemo(() => {
    if (safeSelectedIngresosCategory === "todas") return filteredIngresos;
    return filteredIngresos.filter(
      (mov) => mov.categoryName === safeSelectedIngresosCategory
    );
  }, [filteredIngresos, safeSelectedIngresosCategory]);

  const displayedGastos = useMemo(() => {
    if (safeSelectedGastosCategory === "todas") return filteredGastos;
    return filteredGastos.filter(
      (mov) => mov.categoryName === safeSelectedGastosCategory
    );
  }, [filteredGastos, safeSelectedGastosCategory]);

  const groupIngresosActive =
    groupIngresosByCategory || groupIngresosByDetail;
  const groupGastosActive = groupGastosByCategory || groupGastosByDetail;

  const normalizeQuery = (value: string) =>
    normalizeText(value).replace(/\s+/g, " ").trim();

  const filterMovementRows = (
    rows: typeof displayedIngresos,
    query: string
  ) => {
    if (!query) return rows;
    return rows.filter((mov) => {
      const amount = Math.abs(Number(mov.importe ?? 0));
      const amountNumber = new Intl.NumberFormat("es-ES", {
        maximumFractionDigits: 2,
      }).format(amount);
      const amountCurrency = formatCurrency(amount);
      const haystack = normalizeText(
        `${mov.categoryName} ${mov.detailText ?? ""} ${amount} ${amountNumber} ${amountCurrency}`
      );
      return haystack.includes(query);
    });
  };

  type GroupedRow = {
    key: string;
    categoryName: string;
    detailText: string;
    total: number;
    fijoLabel: "Sí" | "No" | "Mixto";
    latestDate: number;
  };

  type GroupingOptions = {
    byCategory: boolean;
    byDetail: boolean;
  };

  const buildGroupedRows = (
    rows: typeof displayedIngresos,
    options: GroupingOptions
  ): GroupedRow[] => {
    const grouped = new Map<
      string,
      {
        key: string;
        categoryName: string;
        detailText: string;
        total: number;
        hasFijo: boolean;
        hasVariable: boolean;
        latestDate: number;
        categories: Set<string>;
        details: Set<string>;
      }
    >();

    rows.forEach((mov) => {
      const categoryName = mov.categoryName;
      const detailText = mov.detailText ?? "—";
      const movementDate = Number.isFinite(Date.parse(mov.fecha))
        ? Date.parse(mov.fecha)
        : 0;
      const key = `${options.byCategory ? categoryName : "todas"}||${
        options.byDetail ? detailText : "todas"
      }`;
      const existing = grouped.get(key) ?? {
        key,
        categoryName,
        detailText,
        total: 0,
        hasFijo: false,
        hasVariable: false,
        latestDate: 0,
        categories: new Set<string>(),
        details: new Set<string>(),
      };

      const amount = Math.abs(Number(mov.importe ?? 0));
      const isFijo = mov.fijo === true;
      existing.total += amount;
      if (isFijo) {
        existing.hasFijo = true;
      } else {
        existing.hasVariable = true;
      }
      if (movementDate > existing.latestDate) {
        existing.latestDate = movementDate;
      }
      existing.categories.add(categoryName);
      existing.details.add(detailText);

      grouped.set(key, existing);
    });

    return Array.from(grouped.values())
      .map((row) => {
        const fijoLabel: GroupedRow["fijoLabel"] =
          row.hasFijo && row.hasVariable ? "Mixto" : row.hasFijo ? "Sí" : "No";
        const categoryLabel = options.byCategory
          ? row.categoryName
          : row.categories.size === 1
            ? Array.from(row.categories)[0]
            : "Varias";
        const detailLabel = options.byDetail
          ? row.detailText
          : row.details.size === 1
            ? Array.from(row.details)[0]
            : "Varias";
        return {
          key: row.key,
          categoryName: categoryLabel,
          detailText: detailLabel,
          total: row.total,
          fijoLabel,
          latestDate: row.latestDate,
        };
      })
      .sort((a, b) => b.total - a.total);
  };

  const filterGroupedRows = (rows: GroupedRow[], query: string) => {
    if (!query) return rows;
    return rows.filter((row) => {
      const amountNumber = new Intl.NumberFormat("es-ES", {
        maximumFractionDigits: 2,
      }).format(row.total);
      const amountCurrency = formatCurrency(row.total);
      const haystack = normalizeText(
        `${row.categoryName} ${row.detailText} ${row.total} ${amountNumber} ${amountCurrency}`
      );
      return haystack.includes(query);
    });
  };

  const groupedIngresos = groupIngresosActive
    ? buildGroupedRows(displayedIngresos, {
        byCategory: groupIngresosByCategory,
        byDetail: groupIngresosByDetail,
      })
    : [];
  const groupedGastos = groupGastosActive
    ? buildGroupedRows(displayedGastos, {
        byCategory: groupGastosByCategory,
        byDetail: groupGastosByDetail,
      })
    : [];

  const ingresosQuery = normalizeQuery(searchIngresos);
  const gastosQuery = normalizeQuery(searchGastos);

  const searchedIngresosMovs = filterMovementRows(
    displayedIngresos,
    ingresosQuery
  );
  const searchedGastosMovs = filterMovementRows(displayedGastos, gastosQuery);

  const searchedIngresosGrouped = filterGroupedRows(
    groupedIngresos,
    ingresosQuery
  );
  const searchedGastosGrouped = filterGroupedRows(groupedGastos, gastosQuery);

  const filteredIngresosTotal = groupIngresosActive
    ? searchedIngresosGrouped.reduce((sum, row) => sum + row.total, 0)
    : searchedIngresosMovs.reduce((sum, mov) => {
        return sum + Math.abs(Number(mov.importe ?? 0));
      }, 0);

  const filteredGastosTotal = groupGastosActive
    ? searchedGastosGrouped.reduce((sum, row) => sum + row.total, 0)
    : searchedGastosMovs.reduce((sum, mov) => {
        return sum + Math.abs(Number(mov.importe ?? 0));
      }, 0);

  const toggleSort = (
    setter: (value: SortState | ((prev: SortState) => SortState)) => void,
    current: SortState,
    nextKey: SortKey
  ) => {
    if (current.key === nextKey) {
      setter({
        key: nextKey,
        direction: current.direction === "asc" ? "desc" : "asc",
      });
      return;
    }
    setter({
      key: nextKey,
      direction: nextKey === "importe" ? "desc" : "asc",
    });
  };

  const compareText = (a: string, b: string) =>
    a.localeCompare(b, "es-ES", { sensitivity: "base" });

  const sortMovements = (rows: typeof searchedIngresosMovs, sort: SortState) => {
    const sorted = rows.map((row, index) => ({ row, index }));
    sorted.sort((a, b) => {
      const getValue = (mov: typeof searchedIngresosMovs[number]) => {
        switch (sort.key) {
          case "fecha":
            return Date.parse(mov.fecha) || 0;
          case "categoria":
            return mov.categoryName;
          case "detalle":
            return mov.detailText ?? "";
          case "fijo":
            return mov.fijo === true ? 1 : 0;
          case "importe":
          default:
            return Math.abs(Number(mov.importe ?? 0));
        }
      };

      const valueA = getValue(a.row);
      const valueB = getValue(b.row);
      let result = 0;

      if (typeof valueA === "number" && typeof valueB === "number") {
        result = valueA - valueB;
      } else {
        result = compareText(String(valueA), String(valueB));
      }

      if (sort.direction === "desc") {
        result *= -1;
      }

      if (result === 0 && sort.key !== "importe") {
        const secondary =
          Math.abs(Number(b.row.importe ?? 0)) -
          Math.abs(Number(a.row.importe ?? 0));
        if (secondary !== 0) return secondary;
      }

      return result !== 0 ? result : a.index - b.index;
    });
    return sorted.map(({ row }) => row);
  };

  const sortGrouped = (rows: GroupedRow[], sort: SortState) => {
    const fijoRank = (label: GroupedRow["fijoLabel"]) => {
      if (label === "Sí") return 2;
      if (label === "Mixto") return 1;
      return 0;
    };
    const sorted = rows.map((row, index) => ({ row, index }));
    sorted.sort((a, b) => {
      const getValue = (row: GroupedRow) => {
        switch (sort.key) {
          case "fecha":
            return row.latestDate;
          case "categoria":
            return row.categoryName;
          case "detalle":
            return row.detailText;
          case "fijo":
            return fijoRank(row.fijoLabel);
          case "importe":
          default:
            return row.total;
        }
      };

      const valueA = getValue(a.row);
      const valueB = getValue(b.row);
      let result = 0;

      if (typeof valueA === "number" && typeof valueB === "number") {
        result = valueA - valueB;
      } else {
        result = compareText(String(valueA), String(valueB));
      }

      if (sort.direction === "desc") {
        result *= -1;
      }

      if (result === 0 && sort.key !== "importe") {
        const secondary = b.row.total - a.row.total;
        if (secondary !== 0) return secondary;
      }

      return result !== 0 ? result : a.index - b.index;
    });
    return sorted.map(({ row }) => row);
  };

  const sortedIngresosMovs = sortMovements(
    searchedIngresosMovs,
    sortIngresos
  );
  const sortedGastosMovs = sortMovements(searchedGastosMovs, sortGastos);
  const sortedIngresosGrouped = sortGrouped(
    searchedIngresosGrouped,
    sortIngresos
  );
  const sortedGastosGrouped = sortGrouped(searchedGastosGrouped, sortGastos);

  const yearlyEvolution = useMemo(() => {
    if (yearlyMovimientos.length === 0) {
      return {
        years: [] as number[],
      };
    }

    const yearsSet = new Set<number>();

    yearlyMovimientos.forEach((mov) => {
      const year =
        typeof mov.fecha === "string"
          ? Number(mov.fecha.slice(0, 4)) || new Date(mov.fecha).getFullYear()
          : new Date(mov.fecha).getFullYear();
      if (!Number.isFinite(year)) return;
      yearsSet.add(year);
    });

    const years = Array.from(yearsSet).sort((a, b) => a - b);

    return { years };
  }, [yearlyMovimientos]);

  const yearlyCategoryWidth = 84;
  const yearlyRowHeight = 48;
  const yearlyTotalColumnWidth = 96;
  const yearlyYearOptions = yearlyEvolution.years
    .slice()
    .sort((a, b) => b - a);

  const yearlyCategoryOptions = useMemo(() => {
    const selectedYear =
      selectedYearlyYear === "todos" ? null : Number(selectedYearlyYear);
    const set = new Set<string>();
    yearlyMovimientos.forEach((mov) => {
      const year =
        typeof mov.fecha === "string"
          ? Number(mov.fecha.slice(0, 4)) || new Date(mov.fecha).getFullYear()
          : new Date(mov.fecha).getFullYear();
      if (!Number.isFinite(year)) return;
      if (selectedYear !== null && year !== selectedYear) return;
      const category = mov.categoria_nombre ?? "Sin categoría";
      set.add(category);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es-ES"));
  }, [yearlyMovimientos, selectedYearlyYear]);

  const yearlyDetailOptions = useMemo(() => {
    if (selectedYearlyCategory === "todas") return [];
    const selectedYear =
      selectedYearlyYear === "todos" ? null : Number(selectedYearlyYear);
    const set = new Set<string>();
    yearlyMovimientos.forEach((mov) => {
      const year =
        typeof mov.fecha === "string"
          ? Number(mov.fecha.slice(0, 4)) || new Date(mov.fecha).getFullYear()
          : new Date(mov.fecha).getFullYear();
      if (!Number.isFinite(year)) return;
      if (selectedYear !== null && year !== selectedYear) return;
      const category = mov.categoria_nombre ?? "Sin categoría";
      if (category !== selectedYearlyCategory) return;
      const detail =
        typeof mov.detalle === "string" && mov.detalle.trim().length > 0
          ? mov.detalle.trim()
          : "Sin detalle";
      set.add(detail);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es-ES"));
  }, [yearlyMovimientos, selectedYearlyYear, selectedYearlyCategory]);


  const yearlyDisplay = useMemo(() => {
    const yearsSet = new Set<number>();
    const map = new Map<
      string,
      {
        category: string;
        ingresoFijo: Record<number, number>;
        ingresoVariable: Record<number, number>;
        gastoFijo: Record<number, number>;
        gastoVariable: Record<number, number>;
      }
    >();

    const ensureCategory = (key: string, label: string) => {
      const existing = map.get(key);
      if (existing) return existing;
      const next = {
        category: label,
        ingresoFijo: {} as Record<number, number>,
        ingresoVariable: {} as Record<number, number>,
        gastoFijo: {} as Record<number, number>,
        gastoVariable: {} as Record<number, number>,
      };
      map.set(key, next);
      return next;
    };

    const addTo = (
      record: Record<number, number>,
      year: number,
      amount: number
    ) => {
      record[year] = (record[year] ?? 0) + amount;
    };

    const selectedYear =
      selectedYearlyYear === "todos" ? null : Number(selectedYearlyYear);

    yearlyMovimientos.forEach((mov) => {
      const amount = Math.abs(Number(mov.importe ?? 0));
      if (!Number.isFinite(amount) || amount === 0) return;

      const tipoKind = normalizeKindLabel(mov.tipo);
      const kind =
        tipoKind ??
        (Number(mov.importe ?? 0) < 0 ? ("gasto" as const) : "ingreso");
      const fijoRaw = mov.fijo as unknown;
      const fijoLabel = String(fijoRaw ?? "").toLowerCase();
      const isFijo =
        fijoRaw === true ||
        fijoRaw === 1 ||
        fijoRaw === "1" ||
        fijoLabel === "true" ||
        fijoLabel === "t";
      const year =
        typeof mov.fecha === "string"
          ? Number(mov.fecha.slice(0, 4)) || new Date(mov.fecha).getFullYear()
          : new Date(mov.fecha).getFullYear();
      if (!Number.isFinite(year)) return;
      if (selectedYear !== null && year !== selectedYear) return;
      yearsSet.add(year);

      const categoryLabel = mov.categoria_nombre ?? "Sin categoría";
      if (
        selectedYearlyCategory !== "todas" &&
        categoryLabel !== selectedYearlyCategory
      ) {
        return;
      }
      const detailLabel =
        typeof mov.detalle === "string" && mov.detalle.trim().length > 0
          ? mov.detalle.trim()
          : "Sin detalle";
      if (
        selectedYearlyDetail !== "todos" &&
        detailLabel !== selectedYearlyDetail
      ) {
        return;
      }
      const categoryKey = mov.categoria_id ?? categoryLabel;
      const entry = ensureCategory(categoryKey, categoryLabel);

      if (kind === "ingreso") {
        if (isFijo) {
          addTo(entry.ingresoFijo, year, amount);
        } else {
          addTo(entry.ingresoVariable, year, amount);
        }
      } else if (isFijo) {
        addTo(entry.gastoFijo, year, amount);
      } else {
        addTo(entry.gastoVariable, year, amount);
      }
    });

    const years = Array.from(yearsSet).sort((a, b) => a - b);
    const hasKind = showYearlyIngresos || showYearlyGastos;
    const hasFijo = showYearlyFijos || showYearlyVariables;

    if (years.length === 0 || !hasKind || !hasFijo) {
      return {
        years,
        categories: [] as {
          category: string;
          ingresoFijo: Record<number, number>;
          ingresoVariable: Record<number, number>;
          gastoFijo: Record<number, number>;
          gastoVariable: Record<number, number>;
          totalFijo: number;
          totalVariable: number;
          total: number;
        }[],
        maxValue: 1,
        totalsByYear: {} as Record<number, number>,
        totalsByYearFijo: {} as Record<number, number>,
        totalsByYearVariable: {} as Record<number, number>,
        grandTotal: 0,
        grandTotalFijo: 0,
        grandTotalVariable: 0,
      };
    }

    const categories = Array.from(map.values())
      .map((entry) => {
        let totalFijo = 0;
        let totalVariable = 0;
        years.forEach((year) => {
          if (showYearlyIngresos && showYearlyFijos) {
            totalFijo += entry.ingresoFijo[year] ?? 0;
          }
          if (showYearlyGastos && showYearlyFijos) {
            totalFijo += entry.gastoFijo[year] ?? 0;
          }
          if (showYearlyIngresos && showYearlyVariables) {
            totalVariable += entry.ingresoVariable[year] ?? 0;
          }
          if (showYearlyGastos && showYearlyVariables) {
            totalVariable += entry.gastoVariable[year] ?? 0;
          }
        });
        return {
          ...entry,
          totalFijo,
          totalVariable,
          total: totalFijo + totalVariable,
        };
      })
      .filter((entry) => entry.total > 0)
      .sort((a, b) => b.total - a.total);

    let maxValue = 1;
    const totalsByYear: Record<number, number> = {};
    const totalsByYearFijo: Record<number, number> = {};
    const totalsByYearVariable: Record<number, number> = {};
    years.forEach((year) => {
      totalsByYear[year] = 0;
      totalsByYearFijo[year] = 0;
      totalsByYearVariable[year] = 0;
    });
    categories.forEach((category) => {
      years.forEach((year) => {
        const fijoValue =
          (showYearlyIngresos && showYearlyFijos
            ? category.ingresoFijo[year] ?? 0
            : 0) +
          (showYearlyGastos && showYearlyFijos
            ? category.gastoFijo[year] ?? 0
            : 0);
        const variableValue =
          (showYearlyIngresos && showYearlyVariables
            ? category.ingresoVariable[year] ?? 0
            : 0) +
          (showYearlyGastos && showYearlyVariables
            ? category.gastoVariable[year] ?? 0
            : 0);
        const yearTotal =
          fijoValue + variableValue;
        totalsByYear[year] = (totalsByYear[year] ?? 0) + yearTotal;
        totalsByYearFijo[year] =
          (totalsByYearFijo[year] ?? 0) + fijoValue;
        totalsByYearVariable[year] =
          (totalsByYearVariable[year] ?? 0) + variableValue;
        if (showYearlyIngresos && showYearlyFijos) {
          maxValue = Math.max(maxValue, category.ingresoFijo[year] ?? 0);
        }
        if (showYearlyIngresos && showYearlyVariables) {
          maxValue = Math.max(
            maxValue,
            category.ingresoVariable[year] ?? 0
          );
        }
        if (showYearlyGastos && showYearlyFijos) {
          maxValue = Math.max(maxValue, category.gastoFijo[year] ?? 0);
        }
        if (showYearlyGastos && showYearlyVariables) {
          maxValue = Math.max(
            maxValue,
            category.gastoVariable[year] ?? 0
          );
        }
      });
    });

    const grandTotal = Object.values(totalsByYear).reduce(
      (sum, value) => sum + value,
      0
    );

    const grandTotalFijo = Object.values(totalsByYearFijo).reduce(
      (sum, value) => sum + value,
      0
    );
    const grandTotalVariable = Object.values(totalsByYearVariable).reduce(
      (sum, value) => sum + value,
      0
    );

    return {
      years,
      categories,
      maxValue,
      totalsByYear,
      totalsByYearFijo,
      totalsByYearVariable,
      grandTotal,
      grandTotalFijo,
      grandTotalVariable,
    };
  }, [
    yearlyMovimientos,
    showYearlyIngresos,
    showYearlyGastos,
    showYearlyFijos,
    showYearlyVariables,
    selectedYearlyYear,
    selectedYearlyCategory,
    selectedYearlyDetail,
  ]);

  const yearlyDotSize = (value: number) => {
    if (value <= 0) return 0;
    const min = 4;
    const max = 12;
    if (yearlyDisplay.maxValue <= 0) return min;
    return Math.round(
      min + (value / yearlyDisplay.maxValue) * (max - min)
    );
  };

  const yearlyFixedTextClass =
    showYearlyIngresos && !showYearlyGastos
      ? "text-emerald-500"
      : showYearlyGastos && !showYearlyIngresos
        ? "text-rose-500"
        : "text-[var(--foreground)]";
  const yearlyVariableTextClass =
    showYearlyIngresos && !showYearlyGastos
      ? "text-emerald-300"
      : showYearlyGastos && !showYearlyIngresos
        ? "text-rose-300"
        : "text-[var(--muted)]";


  const chartData = useMemo(() => {
    type ChartRow = {
      category: string;
      kind: "ingreso" | "gasto";
      fijo: number;
      variable: number;
      total: number;
    };

    const grouped = new Map<string, ChartRow>();

    const allRows = [...movimientoRows.ingresos, ...movimientoRows.gastos];

    allRows.forEach((mov) => {
      const isFijo = mov.fijo === true;
      if (isFijo && !showChartFijos) return;
      if (!isFijo && !showChartVariables) return;

      const amount = Math.abs(Number(mov.importe ?? 0));
      const category = mov.categoryName;
      const key = `${mov.kind}:${category}`;
      const existing = grouped.get(key) ?? {
        category,
        kind: mov.kind,
        fijo: 0,
        variable: 0,
        total: 0,
      };

      if (isFijo) {
        existing.fijo += amount;
      } else {
        existing.variable += amount;
      }

      existing.total = existing.fijo + existing.variable;
      grouped.set(key, existing);
    });

    const ingresos: ChartRow[] = [];
    const gastos: ChartRow[] = [];

    grouped.forEach((row) => {
      if (row.total === 0) return;
      if (row.kind === "ingreso") {
        ingresos.push(row);
      } else {
        gastos.push(row);
      }
    });

    ingresos.sort((a, b) => b.total - a.total);
    gastos.sort((a, b) => b.total - a.total);

    return { ingresos, gastos };
  }, [
    movimientoRows.ingresos,
    movimientoRows.gastos,
    showChartFijos,
    showChartVariables,
  ]);

  const chartMax = useMemo(() => {
    const allRows = [...chartData.ingresos, ...chartData.gastos];
    if (allRows.length === 0) return 1;
    return Math.max(1, ...allRows.map((row) => row.total));
  }, [chartData]);

  const chartColumnWidth = 128;
  const chartColumnCount =
    chartData.ingresos.length +
    chartData.gastos.length +
    (chartData.ingresos.length > 0 && chartData.gastos.length > 0 ? 1 : 0);
  const chartMinWidth = Math.max(8, chartColumnCount) * chartColumnWidth;

  const activeSelectedSegment = useMemo(() => {
    if (!selectedSegment) return null;
    const source =
      selectedSegment.kind === "ingreso"
        ? chartData.ingresos
        : chartData.gastos;
    const matching = source.find(
      (row) => row.category === selectedSegment.category
    );
    const segmentValue = matching
      ? selectedSegment.fijo
        ? matching.fijo
        : matching.variable
      : 0;

    if (!matching || segmentValue === 0) {
      return null;
    }

    return selectedSegment;
  }, [chartData, selectedSegment]);

  const selectedMovimientos = useMemo(() => {
    if (!activeSelectedSegment) return [];
    const source =
      activeSelectedSegment.kind === "ingreso"
        ? movimientoRows.ingresos
        : movimientoRows.gastos;

    return source.filter((mov) => {
      const isFijo = mov.fijo === true;
      const matchesFijo = activeSelectedSegment.fijo ? isFijo : !isFijo;
      return (
        mov.categoryName === activeSelectedSegment.category &&
        matchesFijo
      );
    });
  }, [movimientoRows, activeSelectedSegment]);

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("es-ES", { month: "short" });
    return Array.from({ length: 12 }, (_, index) =>
      formatter.format(new Date(selectedYear, index, 1))
    );
  }, [selectedYear]);

  const detailGroups = useMemo(() => {
    if (!activeSelectedSegment) return [];

    const byMonth = Array.from({ length: 12 }, () => new Map<string, number>());

    selectedMovimientos.forEach((mov) => {
      const monthIndex = new Date(mov.fecha).getMonth();
      const detail = mov.detailText ?? "Sin detalle";
      const amount = Math.abs(Number(mov.importe ?? 0));
      const bucket = byMonth[monthIndex];
      bucket.set(detail, (bucket.get(detail) ?? 0) + amount);
    });

    return byMonth
      .map((bucket, index) => {
        const items = Array.from(bucket.entries())
          .map(([detail, total]) => ({ detail, total }))
          .sort((a, b) => b.total - a.total);
        const total = items.reduce((sum, item) => sum + item.total, 0);
        return {
          monthIndex: index,
          monthLabel: monthLabels[index],
          items,
          total,
        };
      })
      .filter((group) => group.total > 0);
  }, [monthLabels, selectedMovimientos, activeSelectedSegment]);

  const detailMax = useMemo(() => {
    const totals = detailGroups.flatMap((group) =>
      group.items.map((item) => item.total)
    );
    if (totals.length === 0) return 1;
    return Math.max(1, ...totals);
  }, [detailGroups]);

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

  const selectedSegmentLabel = activeSelectedSegment
    ? `${
        activeSelectedSegment.kind === "ingreso" ? "Ingreso" : "Gasto"
      } ${activeSelectedSegment.fijo ? "fijo" : "variable"} · ${
        activeSelectedSegment.category
      }`
    : null;

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
              Accede a tu cuenta
            </h2>

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
                <div className="relative mt-2">
                  <input
                    className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3 pr-12 text-sm text-[var(--foreground)] shadow-sm outline-none transition focus:border-transparent focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-[var(--muted)] transition hover:text-[var(--foreground)]"
                    aria-label={
                      showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
                    }
                  >
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {showPassword ? (
                        <>
                          <path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Z" />
                          <circle cx="12" cy="12" r="3.5" />
                        </>
                      ) : (
                        <>
                          <path d="M3 12s4-6 9-6 9 6 9 6-4 6-9 6-9-6-9-6Z" />
                          <path d="M4 4l16 16" />
                        </>
                      )}
                    </svg>
                  </button>
                </div>
              </label>
              {authError && (
                <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-700 dark:text-red-300">
                  {authError}
                </p>
              )}
              <button
                type="submit"
                className="w-full cursor-pointer rounded-2xl bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:translate-y-[-1px] hover:bg-[var(--accent-strong)]"
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
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                        Ingresos
                      </p>
                      <input
                        type="search"
                        className="h-7 w-32 rounded-full border border-black/10 bg-white px-3 text-xs text-[var(--foreground)] shadow-sm outline-none transition focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={searchIngresos}
                        onChange={(event) =>
                          setSearchIngresos(event.target.value)
                        }
                        placeholder="Filtrar..."
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
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
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p
                      className="text-3xl font-semibold text-[var(--foreground)]"
                      style={{ fontFamily: "var(--font-fraunces)" }}
                    >
                      {formatCurrency(filteredIngresosTotal)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={safeSelectedIngresosCategory}
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
                        <th className="px-3 py-2 font-semibold">
                          <button
                            type="button"
                            className="flex items-center gap-1"
                            onClick={() =>
                              toggleSort(setSortIngresos, sortIngresos, "fecha")
                            }
                          >
                            <span>Fecha</span>
                            <SortArrow
                              active={sortIngresos.key === "fecha"}
                              direction={
                                sortIngresos.key === "fecha"
                                  ? sortIngresos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex items-center gap-1"
                              onClick={() =>
                                toggleSort(
                                  setSortIngresos,
                                  sortIngresos,
                                  "categoria"
                                )
                              }
                            >
                              <span>Categoría</span>
                              <SortArrow
                                active={sortIngresos.key === "categoria"}
                                direction={
                                  sortIngresos.key === "categoria"
                                    ? sortIngresos.direction
                                    : "desc"
                                }
                              />
                            </button>
                            <GroupToggle
                              active={groupIngresosByCategory}
                              onClick={() =>
                                setGroupIngresosByCategory(
                                  (prev) => !prev
                                )
                              }
                            />
                          </div>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex items-center gap-1"
                              onClick={() =>
                                toggleSort(
                                  setSortIngresos,
                                  sortIngresos,
                                  "detalle"
                                )
                              }
                            >
                              <span>Detalle</span>
                              <SortArrow
                                active={sortIngresos.key === "detalle"}
                                direction={
                                  sortIngresos.key === "detalle"
                                    ? sortIngresos.direction
                                    : "desc"
                                }
                              />
                            </button>
                            <GroupToggle
                              active={groupIngresosByDetail}
                              onClick={() =>
                                setGroupIngresosByDetail((prev) => !prev)
                              }
                            />
                          </div>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <button
                            type="button"
                            className="flex items-center gap-1"
                            onClick={() =>
                              toggleSort(setSortIngresos, sortIngresos, "fijo")
                            }
                          >
                            <span>Fijo</span>
                            <SortArrow
                              active={sortIngresos.key === "fijo"}
                              direction={
                                sortIngresos.key === "fijo"
                                  ? sortIngresos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <button
                            type="button"
                            className="flex w-full items-center justify-end gap-1"
                            onClick={() =>
                              toggleSort(
                                setSortIngresos,
                                sortIngresos,
                                "importe"
                              )
                            }
                          >
                            <span>Importe</span>
                            <SortArrow
                              active={sortIngresos.key === "importe"}
                              direction={
                                sortIngresos.key === "importe"
                                  ? sortIngresos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--foreground)]">
                      {(groupIngresosActive
                        ? sortedIngresosGrouped.length === 0
                        : sortedIngresosMovs.length === 0) && (
                        <tr>
                          <td
                            className="px-3 py-3 text-center text-[var(--muted)]"
                            colSpan={5}
                          >
                            Sin movimientos
                          </td>
                        </tr>
                      )}
                      {groupIngresosActive
                        ? sortedIngresosGrouped.map((row) => (
                            <tr
                              key={row.key}
                              className="border-b border-black/5 last:border-b-0 dark:border-white/10"
                            >
                              <td className="px-3 py-2">—</td>
                              <td className="px-3 py-2">{row.categoryName}</td>
                              <td className="px-3 py-2">{row.detailText}</td>
                              <td className="px-3 py-2">{row.fijoLabel}</td>
                              <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                                {formatCurrency(row.total)}
                              </td>
                            </tr>
                          ))
                        : sortedIngresosMovs.map((mov) => (
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
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                        Gastos
                      </p>
                      <input
                        type="search"
                        className="h-7 w-32 rounded-full border border-black/10 bg-white px-3 text-xs text-[var(--foreground)] shadow-sm outline-none transition focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={searchGastos}
                        onChange={(event) => setSearchGastos(event.target.value)}
                        placeholder="Filtrar..."
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
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
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p
                      className="text-3xl font-semibold text-[var(--foreground)]"
                      style={{ fontFamily: "var(--font-fraunces)" }}
                    >
                      {formatCurrency(filteredGastosTotal)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={safeSelectedGastosCategory}
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
                        <th className="px-3 py-2 font-semibold">
                          <button
                            type="button"
                            className="flex items-center gap-1"
                            onClick={() =>
                              toggleSort(setSortGastos, sortGastos, "fecha")
                            }
                          >
                            <span>Fecha</span>
                            <SortArrow
                              active={sortGastos.key === "fecha"}
                              direction={
                                sortGastos.key === "fecha"
                                  ? sortGastos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex items-center gap-1"
                              onClick={() =>
                                toggleSort(
                                  setSortGastos,
                                  sortGastos,
                                  "categoria"
                                )
                              }
                            >
                              <span>Categoría</span>
                              <SortArrow
                                active={sortGastos.key === "categoria"}
                                direction={
                                  sortGastos.key === "categoria"
                                    ? sortGastos.direction
                                    : "desc"
                                }
                              />
                            </button>
                            <GroupToggle
                              active={groupGastosByCategory}
                              onClick={() =>
                                setGroupGastosByCategory((prev) => !prev)
                              }
                            />
                          </div>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              className="flex items-center gap-1"
                              onClick={() =>
                                toggleSort(
                                  setSortGastos,
                                  sortGastos,
                                  "detalle"
                                )
                              }
                            >
                              <span>Detalle</span>
                              <SortArrow
                                active={sortGastos.key === "detalle"}
                                direction={
                                  sortGastos.key === "detalle"
                                    ? sortGastos.direction
                                    : "desc"
                                }
                              />
                            </button>
                            <GroupToggle
                              active={groupGastosByDetail}
                              onClick={() =>
                                setGroupGastosByDetail((prev) => !prev)
                              }
                            />
                          </div>
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          <button
                            type="button"
                            className="flex items-center gap-1"
                            onClick={() =>
                              toggleSort(setSortGastos, sortGastos, "fijo")
                            }
                          >
                            <span>Fijo</span>
                            <SortArrow
                              active={sortGastos.key === "fijo"}
                              direction={
                                sortGastos.key === "fijo"
                                  ? sortGastos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                        <th className="px-3 py-2 text-right font-semibold">
                          <button
                            type="button"
                            className="flex w-full items-center justify-end gap-1"
                            onClick={() =>
                              toggleSort(setSortGastos, sortGastos, "importe")
                            }
                          >
                            <span>Importe</span>
                            <SortArrow
                              active={sortGastos.key === "importe"}
                              direction={
                                sortGastos.key === "importe"
                                  ? sortGastos.direction
                                  : "desc"
                              }
                            />
                          </button>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="text-[var(--foreground)]">
                      {(groupGastosActive
                        ? sortedGastosGrouped.length === 0
                        : sortedGastosMovs.length === 0) && (
                        <tr>
                          <td
                            className="px-3 py-3 text-center text-[var(--muted)]"
                            colSpan={5}
                          >
                            Sin movimientos
                          </td>
                        </tr>
                      )}
                      {groupGastosActive
                        ? sortedGastosGrouped.map((row) => (
                            <tr
                              key={row.key}
                              className="border-b border-black/5 last:border-b-0 dark:border-white/10"
                            >
                              <td className="px-3 py-2">—</td>
                              <td className="px-3 py-2">{row.categoryName}</td>
                              <td className="px-3 py-2">{row.detailText}</td>
                              <td className="px-3 py-2">{row.fijoLabel}</td>
                              <td className="px-3 py-2 text-right font-semibold text-rose-600 dark:text-rose-400">
                                {formatMovementAmount({
                                  importe: row.total,
                                  kind: "gasto",
                                })}
                              </td>
                            </tr>
                          ))
                        : sortedGastosMovs.map((mov) => (
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

            <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Visualización
                  </p>
                  <h2
                    className="mt-2 text-2xl font-semibold text-[var(--foreground)]"
                    style={{ fontFamily: "var(--font-fraunces)" }}
                  >
                    Ingresos y gastos por categoría
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Eje X con categorías y eje Y con importes. Ingresos primero,
                    gastos después, con apilado fijo/variable.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span>Año</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyYear}
                        onChange={(event) => {
                          setSelectedYearlyYear(event.target.value);
                          setSelectedYearlyCategory("todas");
                          setSelectedYearlyDetail("todos");
                        }}
                        disabled={yearlyYearOptions.length === 0}
                      >
                        <option value="todos">Todos</option>
                        {yearlyYearOptions.map((year) => (
                          <option key={year} value={String(year)}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyCategory}
                        onChange={(event) => {
                          setSelectedYearlyCategory(event.target.value);
                          setSelectedYearlyDetail("todos");
                        }}
                        disabled={yearlyCategoryOptions.length === 0}
                      >
                        <option value="todas">Todas</option>
                        {yearlyCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Detalle</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyDetail}
                        onChange={(event) =>
                          setSelectedYearlyDetail(event.target.value)
                        }
                        disabled={
                          selectedYearlyCategory === "todas" ||
                          yearlyDetailOptions.length === 0
                        }
                      >
                        <option value="todos">Todos</option>
                        {yearlyDetailOptions.map((detail) => (
                          <option key={detail} value={detail}>
                            {detail}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showChartFijos}
                      onChange={(event) =>
                        setShowChartFijos(event.target.checked)
                      }
                    />
                    Fijos
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showChartVariables}
                      onChange={(event) =>
                        setShowChartVariables(event.target.checked)
                      }
                    />
                    Variables
                  </label>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      Ingreso fijo
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      Ingreso variable
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-rose-600" />
                      Gasto fijo
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-rose-300" />
                      Gasto variable
                    </span>
                  </div>
                </div>
              </div>

              <div
                className="mt-6 max-w-full overflow-x-auto pb-2"
                style={{ scrollbarGutter: "stable" }}
              >
                {chartData.ingresos.length === 0 &&
                chartData.gastos.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                    No hay datos para mostrar con los filtros actuales.
                  </div>
                ) : (
                  <div
                    className="relative"
                    style={{ minWidth: `${chartMinWidth}px` }}
                  >
                    <div className="pointer-events-none absolute inset-x-0 bottom-6 top-6 flex flex-col justify-between">
                      {[0, 1, 2, 3, 4].map((line) => (
                        <div
                          key={line}
                          className="h-px bg-black/5 dark:bg-white/10"
                        />
                      ))}
                    </div>
                    <div className="relative flex min-w-max items-end gap-6 pb-6 pt-6">
                      <div className="flex items-end gap-4">
                        {chartData.ingresos.map((row) => (
                          <div
                            key={`ingreso-${row.category}`}
                            className="flex w-32 flex-col items-center gap-2"
                          >
                            <span className="text-[11px] font-semibold text-emerald-500 dark:text-emerald-400">
                              {formatCurrency(row.total)}
                            </span>
                            <div className="flex h-40 w-10 flex-col-reverse overflow-hidden rounded-full bg-black/5 shadow-inner dark:bg-white/10">
                              <div
                                className={`bg-emerald-600 transition ${
                                  row.fijo > 0
                                    ? "cursor-pointer hover:opacity-80"
                                    : "cursor-default"
                                } ${
                                  activeSelectedSegment?.kind === "ingreso" &&
                                  activeSelectedSegment.fijo &&
                                  activeSelectedSegment.category === row.category
                                    ? "ring-2 ring-emerald-300"
                                    : ""
                                }`}
                                style={{
                                  height: `${(row.fijo / chartMax) * 100}%`,
                                }}
                                onClick={
                                  row.fijo > 0
                                    ? () =>
                                        setSelectedSegment({
                                          kind: "ingreso",
                                          fijo: true,
                                          category: row.category,
                                        })
                                    : undefined
                                }
                                role={row.fijo > 0 ? "button" : undefined}
                                title={
                                  row.fijo > 0
                                    ? `Ingreso fijo · ${row.category}`
                                    : undefined
                                }
                              />
                              <div
                                className={`bg-emerald-300 transition ${
                                  row.variable > 0
                                    ? "cursor-pointer hover:opacity-80"
                                    : "cursor-default"
                                } ${
                                  activeSelectedSegment?.kind === "ingreso" &&
                                  !activeSelectedSegment.fijo &&
                                  activeSelectedSegment.category === row.category
                                    ? "ring-2 ring-emerald-200"
                                    : ""
                                }`}
                                style={{
                                  height: `${(row.variable / chartMax) * 100}%`,
                                }}
                                onClick={
                                  row.variable > 0
                                    ? () =>
                                        setSelectedSegment({
                                          kind: "ingreso",
                                          fijo: false,
                                          category: row.category,
                                        })
                                    : undefined
                                }
                                role={row.variable > 0 ? "button" : undefined}
                                title={
                                  row.variable > 0
                                    ? `Ingreso variable · ${row.category}`
                                    : undefined
                                }
                              />
                            </div>
                            <span className="text-center text-[11px] leading-snug text-[var(--muted)]">
                              {row.category}
                            </span>
                          </div>
                        ))}
                      </div>

                      {chartData.ingresos.length > 0 &&
                      chartData.gastos.length > 0 ? (
                        <div className="flex h-full items-end">
                          <div className="h-full w-px bg-black/10 dark:bg-white/10" />
                        </div>
                      ) : null}

                      <div className="flex items-end gap-4">
                        {chartData.gastos.map((row) => (
                          <div
                            key={`gasto-${row.category}`}
                            className="flex w-32 flex-col items-center gap-2"
                          >
                            <span className="text-[11px] font-semibold text-rose-500 dark:text-rose-400">
                              {formatCurrency(row.total)}
                            </span>
                            <div className="flex h-40 w-10 flex-col-reverse overflow-hidden rounded-full bg-black/5 shadow-inner dark:bg-white/10">
                              <div
                                className={`bg-rose-600 transition ${
                                  row.fijo > 0
                                    ? "cursor-pointer hover:opacity-80"
                                    : "cursor-default"
                                } ${
                                  activeSelectedSegment?.kind === "gasto" &&
                                  activeSelectedSegment.fijo &&
                                  activeSelectedSegment.category === row.category
                                    ? "ring-2 ring-rose-300"
                                    : ""
                                }`}
                                style={{
                                  height: `${(row.fijo / chartMax) * 100}%`,
                                }}
                                onClick={
                                  row.fijo > 0
                                    ? () =>
                                        setSelectedSegment({
                                          kind: "gasto",
                                          fijo: true,
                                          category: row.category,
                                        })
                                    : undefined
                                }
                                role={row.fijo > 0 ? "button" : undefined}
                                title={
                                  row.fijo > 0
                                    ? `Gasto fijo · ${row.category}`
                                    : undefined
                                }
                              />
                              <div
                                className={`bg-rose-300 transition ${
                                  row.variable > 0
                                    ? "cursor-pointer hover:opacity-80"
                                    : "cursor-default"
                                } ${
                                  activeSelectedSegment?.kind === "gasto" &&
                                  !activeSelectedSegment.fijo &&
                                  activeSelectedSegment.category === row.category
                                    ? "ring-2 ring-rose-200"
                                    : ""
                                }`}
                                style={{
                                  height: `${(row.variable / chartMax) * 100}%`,
                                }}
                                onClick={
                                  row.variable > 0
                                    ? () =>
                                        setSelectedSegment({
                                          kind: "gasto",
                                          fijo: false,
                                          category: row.category,
                                        })
                                    : undefined
                                }
                                role={row.variable > 0 ? "button" : undefined}
                                title={
                                  row.variable > 0
                                    ? `Gasto variable · ${row.category}`
                                    : undefined
                                }
                              />
                            </div>
                            <span className="text-center text-[11px] leading-snug text-[var(--muted)]">
                              {row.category}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 flex min-w-max items-center justify-between text-[11px] uppercase tracking-[0.3em] text-[var(--muted)]">
                      <span>Ingresos</span>
                      <span>Gastos</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Detalle
                  </p>
                  <h3
                    className="mt-2 text-xl font-semibold text-[var(--foreground)]"
                    style={{ fontFamily: "var(--font-fraunces)" }}
                  >
                    {activeSelectedSegment
                      ? selectedSegmentLabel
                      : "Selecciona una barra"}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {activeSelectedSegment
                      ? "Importes por detalle agrupados por mes."
                      : "Haz clic en una barra para ver el desglose mensual."}
                  </p>
                </div>
                {activeSelectedSegment && (
                  <button
                    onClick={() => setSelectedSegment(null)}
                    className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:border-white/10"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>

              {activeSelectedSegment && (
                <div className="mt-6 max-w-full overflow-x-auto pb-2">
                  {detailGroups.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                      No hay detalles disponibles para esta selección.
                    </div>
                  ) : (
                    <div className="flex min-w-max items-end gap-8">
                      {detailGroups.map((group) => (
                        <div
                          key={group.monthIndex}
                          className="flex flex-col items-center gap-3"
                        >
                          <div className="flex items-end gap-3">
                            {group.items.map((item) => (
                              <div
                                key={`${group.monthIndex}-${item.detail}`}
                                className="flex w-20 flex-col items-center gap-2"
                              >
                                <span className="text-[11px] font-semibold text-[var(--foreground)]">
                                  {formatCurrency(item.total)}
                                </span>
                                <div className="flex h-36 w-8 flex-col-reverse overflow-hidden rounded-full bg-black/5 shadow-inner dark:bg-white/10">
                                  <div
                                    className={`${
                                      activeSelectedSegment.kind === "ingreso"
                                        ? "bg-emerald-500"
                                        : "bg-rose-500"
                                    }`}
                                    style={{
                                      height: `${
                                        (item.total / detailMax) * 100
                                      }%`,
                                    }}
                                  />
                                </div>
                                <span className="text-center text-[11px] leading-snug text-[var(--muted)]">
                                  {item.detail}
                                </span>
                              </div>
                            ))}
                          </div>
                          <span className="text-[11px] uppercase tracking-[0.3em] text-[var(--muted)]">
                            {group.monthLabel}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-black/10 bg-[var(--surface)] p-5 shadow-[0_24px_60px_rgba(15,23,42,0.08)] dark:border-white/10">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-[var(--muted)]">
                    Evolución anual
                  </p>
                  <h3
                    className="mt-2 text-xl font-semibold text-[var(--foreground)]"
                    style={{ fontFamily: "var(--font-fraunces)" }}
                  >
                    Ingresos y gastos por categoría
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Evolucion por año agrupado por categorias
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--muted)]">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <span>Año</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyYear}
                        onChange={(event) => {
                          setSelectedYearlyYear(event.target.value);
                          setSelectedYearlyCategory("todas");
                          setSelectedYearlyDetail("todos");
                        }}
                        disabled={yearlyYearOptions.length === 0}
                      >
                        <option value="todos">Todos</option>
                        {yearlyYearOptions.map((year) => (
                          <option key={year} value={String(year)}>
                            {year}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Categoría</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyCategory}
                        onChange={(event) => {
                          setSelectedYearlyCategory(event.target.value);
                          setSelectedYearlyDetail("todos");
                        }}
                        disabled={yearlyCategoryOptions.length === 0}
                      >
                        <option value="todas">Todas</option>
                        {yearlyCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <span>Detalle</span>
                      <select
                        className="rounded-full border border-black/10 bg-white px-3 py-1 text-xs text-[var(--foreground)] shadow-sm outline-none focus:ring-2 focus:ring-[var(--ring)] dark:border-white/10 dark:bg-black/60"
                        value={selectedYearlyDetail}
                        onChange={(event) =>
                          setSelectedYearlyDetail(event.target.value)
                        }
                        disabled={
                          selectedYearlyCategory === "todas" ||
                          yearlyDetailOptions.length === 0
                        }
                      >
                        <option value="todos">Todos</option>
                        {yearlyDetailOptions.map((detail) => (
                          <option key={detail} value={detail}>
                            {detail}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showYearlyIngresos}
                      onChange={(event) =>
                        setShowYearlyIngresos(event.target.checked)
                      }
                    />
                    Ingresos
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showYearlyGastos}
                      onChange={(event) =>
                        setShowYearlyGastos(event.target.checked)
                      }
                    />
                    Gastos
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showYearlyFijos}
                      onChange={(event) =>
                        setShowYearlyFijos(event.target.checked)
                      }
                    />
                    Fijos
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="accent-[var(--accent)]"
                      checked={showYearlyVariables}
                      onChange={(event) =>
                        setShowYearlyVariables(event.target.checked)
                      }
                    />
                    Variables
                  </label>
                  <div className="flex flex-wrap items-center gap-3 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-600" />
                      Ingreso fijo
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      Ingreso variable
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-rose-600" />
                      Gasto fijo
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-rose-300" />
                      Gasto variable
                    </span>
                  </div>
                  {yearlyLoading && (
                    <span className="rounded-full border border-black/10 bg-white px-3 py-1 text-[11px] text-[var(--muted)] shadow-sm dark:border-white/10 dark:bg-black/60">
                      Actualizando...
                    </span>
                  )}
                </div>
              </div>

              {yearlyError && (
                <p className="mt-4 rounded-2xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-700 dark:text-red-300">
                  {yearlyError}
                </p>
              )}

              {!yearlyLoading && yearlyEvolution.years.length === 0 && (
                <div className="mt-4 rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                  No hay datos suficientes para mostrar la evolución anual.
                </div>
              )}

              {yearlyEvolution.years.length > 0 && (
                <div className="mt-6">
                  {(!showYearlyIngresos && !showYearlyGastos) ||
                  (!showYearlyFijos && !showYearlyVariables) ? (
                    <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                      Activa ingresos/gastos y fijos/variables para ver la
                      evolución anual.
                    </div>
                  ) : yearlyDisplay.categories.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-black/10 px-4 py-6 text-center text-sm text-[var(--muted)] dark:border-white/10">
                      No hay datos suficientes para mostrar la evolución anual.
                    </div>
                  ) : (
                    <div
                      className="mt-4 max-w-full overflow-x-auto pb-2"
                      style={{ scrollbarGutter: "stable" }}
                    >
                      <div className="min-w-max">
                        <div className="flex flex-col gap-2">
                          {[...yearlyDisplay.years].reverse().map((year) => (
                            <div key={year} className="flex items-end gap-4">
                              <div
                                className="flex items-end justify-end text-[11px] text-[var(--muted)]"
                                style={{ width: "2.5rem", height: yearlyRowHeight }}
                              >
                                {year}
                              </div>
                              <div className="flex items-end gap-4">
                                {yearlyDisplay.categories.map((category) => {
                                  const ingresoFijoValue =
                                    category.ingresoFijo[year] ?? 0;
                                  const ingresoVariableValue =
                                    category.ingresoVariable[year] ?? 0;
                                  const gastoFijoValue =
                                    category.gastoFijo[year] ?? 0;
                                  const gastoVariableValue =
                                    category.gastoVariable[year] ?? 0;
                                  const showIngresoFijoDot =
                                    showYearlyIngresos &&
                                    showYearlyFijos &&
                                    ingresoFijoValue > 0;
                                  const showIngresoVariableDot =
                                    showYearlyIngresos &&
                                    showYearlyVariables &&
                                    ingresoVariableValue > 0;
                                  const showGastoFijoDot =
                                    showYearlyGastos &&
                                    showYearlyFijos &&
                                    gastoFijoValue > 0;
                                  const showGastoVariableDot =
                                    showYearlyGastos &&
                                    showYearlyVariables &&
                                    gastoVariableValue > 0;
                                  return (
                                    <div
                                      key={`${category.category}-${year}`}
                                      className="relative"
                                      style={{
                                        width: `${yearlyCategoryWidth}px`,
                                        height: `${yearlyRowHeight}px`,
                                      }}
                                    >
                                      <div className="absolute left-0 right-0 bottom-0 h-px bg-black/5 dark:bg-white/10" />
                                      {(showIngresoFijoDot ||
                                        showIngresoVariableDot ||
                                        showGastoFijoDot ||
                                        showGastoVariableDot) && (
                                        <div className="absolute bottom-0 left-1/2 -translate-x-1/2">
                                          <div className="flex items-end gap-2">
                                            {showIngresoFijoDot && (
                                              <div className="flex flex-col items-center">
                                                <span className="mb-1 whitespace-nowrap text-[10px] font-semibold text-emerald-500">
                                                  {formatShortCurrency(
                                                    ingresoFijoValue
                                                  )}
                                                </span>
                                                <span
                                                  className="rounded-full bg-emerald-600"
                                                  style={{
                                                    width: `${yearlyDotSize(
                                                      ingresoFijoValue
                                                    )}px`,
                                                    height: `${yearlyDotSize(
                                                      ingresoFijoValue
                                                    )}px`,
                                                  }}
                                                  title={`${category.category} · ${year} · Ingresos fijos: ${formatCurrency(
                                                    ingresoFijoValue
                                                  )}`}
                                                />
                                              </div>
                                            )}
                                            {showIngresoVariableDot && (
                                              <div className="flex flex-col items-center">
                                                <span className="mb-1 whitespace-nowrap text-[10px] font-semibold text-emerald-300">
                                                  {formatShortCurrency(
                                                    ingresoVariableValue
                                                  )}
                                                </span>
                                                <span
                                                  className="rounded-full bg-emerald-300"
                                                  style={{
                                                    width: `${yearlyDotSize(
                                                      ingresoVariableValue
                                                    )}px`,
                                                    height: `${yearlyDotSize(
                                                      ingresoVariableValue
                                                    )}px`,
                                                  }}
                                                  title={`${category.category} · ${year} · Ingresos variables: ${formatCurrency(
                                                    ingresoVariableValue
                                                  )}`}
                                                />
                                              </div>
                                            )}
                                            {showGastoFijoDot && (
                                              <div className="flex flex-col items-center">
                                                <span className="mb-1 whitespace-nowrap text-[10px] font-semibold text-rose-500">
                                                  {formatShortCurrency(
                                                    gastoFijoValue
                                                  )}
                                                </span>
                                                <span
                                                  className="rounded-full bg-rose-600"
                                                  style={{
                                                    width: `${yearlyDotSize(
                                                      gastoFijoValue
                                                    )}px`,
                                                    height: `${yearlyDotSize(
                                                      gastoFijoValue
                                                    )}px`,
                                                  }}
                                                  title={`${category.category} · ${year} · Gastos fijos: ${formatCurrency(
                                                    gastoFijoValue
                                                  )}`}
                                                />
                                              </div>
                                            )}
                                            {showGastoVariableDot && (
                                              <div className="flex flex-col items-center">
                                                <span className="mb-1 whitespace-nowrap text-[10px] font-semibold text-rose-300">
                                                  {formatShortCurrency(
                                                    gastoVariableValue
                                                  )}
                                                </span>
                                                <span
                                                  className="rounded-full bg-rose-300"
                                                  style={{
                                                    width: `${yearlyDotSize(
                                                      gastoVariableValue
                                                    )}px`,
                                                    height: `${yearlyDotSize(
                                                      gastoVariableValue
                                                    )}px`,
                                                  }}
                                                  title={`${category.category} · ${year} · Gastos variables: ${formatCurrency(
                                                    gastoVariableValue
                                                  )}`}
                                                />
                                              </div>
                                            )}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                <div
                                  className="flex items-end justify-center"
                                  style={{
                                    width: `${yearlyTotalColumnWidth}px`,
                                    height: `${yearlyRowHeight}px`,
                                  }}
                                >
                                  <div className="flex h-full w-full flex-col items-center justify-end gap-1">
                                    {showYearlyFijos && (
                                      <span
                                        className={`whitespace-nowrap text-[10px] font-semibold ${yearlyFixedTextClass}`}
                                      >
                                        {formatShortCurrency(
                                          yearlyDisplay.totalsByYearFijo[year] ??
                                            0
                                        )}
                                      </span>
                                    )}
                                    {showYearlyVariables && (
                                      <span
                                        className={`whitespace-nowrap text-[10px] font-semibold ${yearlyVariableTextClass}`}
                                      >
                                        {formatShortCurrency(
                                          yearlyDisplay.totalsByYearVariable[year] ??
                                            0
                                        )}
                                      </span>
                                    )}
                                    {showYearlyFijos && showYearlyVariables && (
                                      <span className="whitespace-nowrap text-[10px] font-semibold text-[var(--foreground)]">
                                        {formatShortCurrency(
                                          yearlyDisplay.totalsByYear[year] ?? 0
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-3 flex items-start gap-4">
                          <span
                            className="text-right text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]"
                            style={{ width: "2.5rem" }}
                          >
                            Año
                          </span>
                          <div className="flex items-start gap-4">
                            {yearlyDisplay.categories.map((category) => (
                              <span
                                key={`cat-${category.category}`}
                                className="text-center text-[11px] leading-snug text-[var(--muted)]"
                                style={{ width: `${yearlyCategoryWidth}px` }}
                              >
                                {category.category}
                              </span>
                            ))}
                            <span
                              className="text-center text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]"
                              style={{ width: `${yearlyTotalColumnWidth}px` }}
                            >
                              Total
                            </span>
                          </div>
                        </div>
                        <div className="mt-1 flex items-start gap-4">
                          <span
                            className="text-right text-[11px] font-semibold text-[var(--muted)]"
                            style={{ width: "2.5rem" }}
                          >
                            Total
                          </span>
                          <div className="flex items-start gap-4">
                            {yearlyDisplay.categories.map((category) => (
                              <span
                                key={`cat-total-${category.category}`}
                                className="text-center text-[11px] font-semibold text-[var(--foreground)]"
                                style={{ width: `${yearlyCategoryWidth}px` }}
                              >
                                <span className="flex flex-col items-center gap-1">
                                  {showYearlyFijos && (
                                    <span
                                      className={`whitespace-nowrap text-[10px] font-semibold ${yearlyFixedTextClass}`}
                                    >
                                      {formatShortCurrency(category.totalFijo)}
                                    </span>
                                  )}
                                  {showYearlyVariables && (
                                    <span
                                      className={`whitespace-nowrap text-[10px] font-semibold ${yearlyVariableTextClass}`}
                                    >
                                      {formatShortCurrency(
                                        category.totalVariable
                                      )}
                                    </span>
                                  )}
                                  {showYearlyFijos && showYearlyVariables && (
                                    <span className="whitespace-nowrap text-[10px] font-semibold text-[var(--foreground)]">
                                      {formatShortCurrency(category.total)}
                                    </span>
                                  )}
                                </span>
                              </span>
                            ))}
                            <span
                              className="text-center text-[11px] font-semibold text-[var(--foreground)]"
                              style={{ width: `${yearlyTotalColumnWidth}px` }}
                            >
                              <span className="flex flex-col items-center gap-1">
                                {showYearlyFijos && (
                                  <span
                                    className={`whitespace-nowrap text-[10px] font-semibold ${yearlyFixedTextClass}`}
                                  >
                                    {formatShortCurrency(
                                      yearlyDisplay.grandTotalFijo
                                    )}
                                  </span>
                                )}
                                {showYearlyVariables && (
                                  <span
                                    className={`whitespace-nowrap text-[10px] font-semibold ${yearlyVariableTextClass}`}
                                  >
                                    {formatShortCurrency(
                                      yearlyDisplay.grandTotalVariable
                                    )}
                                  </span>
                                )}
                                {showYearlyFijos && showYearlyVariables && (
                                  <span className="whitespace-nowrap text-[10px] font-semibold text-[var(--foreground)]">
                                    {formatShortCurrency(
                                      yearlyDisplay.grandTotal
                                    )}
                                  </span>
                                )}
                              </span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
