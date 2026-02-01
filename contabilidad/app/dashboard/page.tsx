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

type SortKey = "fecha" | "categoria" | "detalle" | "fijo" | "importe";
type SortDirection = "asc" | "desc";
type SortState = { key: SortKey; direction: SortDirection };

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
  const [showChartFijos, setShowChartFijos] = useState(true);
  const [showChartVariables, setShowChartVariables] = useState(true);
  const [searchIngresos, setSearchIngresos] = useState("");
  const [searchGastos, setSearchGastos] = useState("");
  const [groupIngresos, setGroupIngresos] = useState(true);
  const [groupGastos, setGroupGastos] = useState(true);
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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("es-ES", {
      style: "currency",
      currency,
      maximumFractionDigits: 2,
    }).format(value);

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

  const buildGroupedRows = (rows: typeof displayedIngresos): GroupedRow[] => {
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
      }
    >();

    rows.forEach((mov) => {
      const categoryName = mov.categoryName;
      const detailText = mov.detailText ?? "—";
      const movementDate = Number.isFinite(Date.parse(mov.fecha))
        ? Date.parse(mov.fecha)
        : 0;
      const key = `${categoryName}||${detailText}`;
      const existing = grouped.get(key) ?? {
        key,
        categoryName,
        detailText,
        total: 0,
        hasFijo: false,
        hasVariable: false,
        latestDate: 0,
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

      grouped.set(key, existing);
    });

    return Array.from(grouped.values())
      .map((row) => ({
        key: row.key,
        categoryName: row.categoryName,
        detailText: row.detailText,
        total: row.total,
        fijoLabel: row.hasFijo && row.hasVariable ? "Mixto" : row.hasFijo ? "Sí" : "No",
        latestDate: row.latestDate,
      }))
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

  const groupedIngresos = useMemo(
    () => buildGroupedRows(displayedIngresos),
    [displayedIngresos]
  );
  const groupedGastos = useMemo(
    () => buildGroupedRows(displayedGastos),
    [displayedGastos]
  );

  const ingresosQuery = normalizeQuery(searchIngresos);
  const gastosQuery = normalizeQuery(searchGastos);

  const searchedIngresosMovs = useMemo(
    () => filterMovementRows(displayedIngresos, ingresosQuery),
    [displayedIngresos, ingresosQuery, currency]
  );
  const searchedGastosMovs = useMemo(
    () => filterMovementRows(displayedGastos, gastosQuery),
    [displayedGastos, gastosQuery, currency]
  );

  const searchedIngresosGrouped = useMemo(
    () => filterGroupedRows(groupedIngresos, ingresosQuery),
    [groupedIngresos, ingresosQuery, currency]
  );
  const searchedGastosGrouped = useMemo(
    () => filterGroupedRows(groupedGastos, gastosQuery),
    [groupedGastos, gastosQuery, currency]
  );

  const filteredIngresosTotal = useMemo(() => {
    if (groupIngresos) {
      return searchedIngresosGrouped.reduce((sum, row) => sum + row.total, 0);
    }
    return searchedIngresosMovs.reduce((sum, mov) => {
      return sum + Math.abs(Number(mov.importe ?? 0));
    }, 0);
  }, [groupIngresos, searchedIngresosGrouped, searchedIngresosMovs]);

  const filteredGastosTotal = useMemo(() => {
    if (groupGastos) {
      return searchedGastosGrouped.reduce((sum, row) => sum + row.total, 0);
    }
    return searchedGastosMovs.reduce((sum, mov) => {
      return sum + Math.abs(Number(mov.importe ?? 0));
    }, 0);
  }, [groupGastos, searchedGastosGrouped, searchedGastosMovs]);

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

  const sortedIngresosMovs = useMemo(
    () => sortMovements(searchedIngresosMovs, sortIngresos),
    [searchedIngresosMovs, sortIngresos]
  );
  const sortedGastosMovs = useMemo(
    () => sortMovements(searchedGastosMovs, sortGastos),
    [searchedGastosMovs, sortGastos]
  );
  const sortedIngresosGrouped = useMemo(
    () => sortGrouped(searchedIngresosGrouped, sortIngresos),
    [searchedIngresosGrouped, sortIngresos]
  );
  const sortedGastosGrouped = useMemo(
    () => sortGrouped(searchedGastosGrouped, sortGastos),
    [searchedGastosGrouped, sortGastos]
  );

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

  useEffect(() => {
    if (!selectedSegment) return;
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
      setSelectedSegment(null);
    }
  }, [chartData, selectedSegment]);

  const selectedMovimientos = useMemo(() => {
    if (!selectedSegment) return [];
    const source =
      selectedSegment.kind === "ingreso"
        ? movimientoRows.ingresos
        : movimientoRows.gastos;

    return source.filter((mov) => {
      const isFijo = mov.fijo === true;
      const matchesFijo = selectedSegment.fijo ? isFijo : !isFijo;
      return (
        mov.categoryName === selectedSegment.category &&
        matchesFijo
      );
    });
  }, [movimientoRows, selectedSegment]);

  const monthLabels = useMemo(() => {
    const formatter = new Intl.DateTimeFormat("es-ES", { month: "short" });
    return Array.from({ length: 12 }, (_, index) =>
      formatter.format(new Date(selectedYear, index, 1))
    );
  }, [selectedYear]);

  const detailGroups = useMemo(() => {
    if (!selectedSegment) return [];

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
  }, [monthLabels, selectedMovimientos, selectedSegment]);

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

  const selectedSegmentLabel = selectedSegment
    ? `${
        selectedSegment.kind === "ingreso" ? "Ingreso" : "Gasto"
      } ${selectedSegment.fijo ? "fijo" : "variable"} · ${
        selectedSegment.category
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
                      <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={groupIngresos}
                          onChange={(event) =>
                            setGroupIngresos(event.target.checked)
                          }
                        />
                        Agrupar
                      </label>
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
                        </th>
                        <th className="px-3 py-2 font-semibold">
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
                      {(groupIngresos
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
                      {groupIngresos
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
                      <label className="flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-[var(--muted)]">
                        <input
                          type="checkbox"
                          className="accent-[var(--accent)]"
                          checked={groupGastos}
                          onChange={(event) =>
                            setGroupGastos(event.target.checked)
                          }
                        />
                        Agrupar
                      </label>
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
                        </th>
                        <th className="px-3 py-2 font-semibold">
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
                      {(groupGastos
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
                      {groupGastos
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
                                  selectedSegment?.kind === "ingreso" &&
                                  selectedSegment.fijo &&
                                  selectedSegment.category === row.category
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
                                  selectedSegment?.kind === "ingreso" &&
                                  !selectedSegment.fijo &&
                                  selectedSegment.category === row.category
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
                                  selectedSegment?.kind === "gasto" &&
                                  selectedSegment.fijo &&
                                  selectedSegment.category === row.category
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
                                  selectedSegment?.kind === "gasto" &&
                                  !selectedSegment.fijo &&
                                  selectedSegment.category === row.category
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
                    {selectedSegment ? selectedSegmentLabel : "Selecciona una barra"}
                  </h3>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    {selectedSegment
                      ? "Importes por detalle agrupados por mes."
                      : "Haz clic en una barra para ver el desglose mensual."}
                  </p>
                </div>
                {selectedSegment && (
                  <button
                    onClick={() => setSelectedSegment(null)}
                    className="rounded-full border border-black/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] dark:border-white/10"
                  >
                    Limpiar selección
                  </button>
                )}
              </div>

              {selectedSegment && (
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
                                      selectedSegment.kind === "ingreso"
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
          </div>
        )}
      </div>
    </div>
  );
}
