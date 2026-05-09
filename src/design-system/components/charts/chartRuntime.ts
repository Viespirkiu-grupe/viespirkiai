declare global {
  interface Window {
    ApexCharts?: any;
    displayChart?: (data: any) => Promise<void>;
    ensureChartRuntime?: () => Promise<void>;
    __chartsRuntimeInitialized?: boolean;
    __chartsRuntimePromise?: Promise<void>;
  }
}

function ensureTooltipStyles() {
  if (document.getElementById('charts-runtime-styles')) return;
  const style = document.createElement('style');
  style.id = 'charts-runtime-styles';
  style.textContent = `
    .chart { background-color: transparent; }
    .dark .apexcharts-tooltip,
    .dark .apexcharts-tooltip-title {
      background: #1c1917 !important;
      color: #f5f4f4 !important;
      border-color: #292524 !important;
    }
  `;
  document.head.appendChild(style);
}

function deepMerge(target: Record<string, any>, source: Record<string, any>) {
  for (const key in source) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key]) target[key] = {};
      deepMerge(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
  return target;
}

const getIsDark = () => document.documentElement.classList.contains('dark');
const getThemeTokens = (isDark: boolean) => ({
  foreground: isDark ? '#f5f4f4' : '#0c0a09',
  labelColor: isDark ? '#a8a29e' : '#292524',
  gridColor: isDark ? '#292524' : '#e7e5e4',
  tooltipBg: isDark ? '#1c1917' : '#fafaf9',
  tooltipText: isDark ? '#f5f4f4' : '#0c0a09',
  tooltipBorder: isDark ? '#292524' : '#d6d3d1',
});

const CATEGORICAL_COLORS = {
  light: ['#0c0a09', '#79716b', '#e7e5e4'],
  dark: ['#f5f4f4', '#79716b', '#292524'],
};

const getCategoricalColors = (isDark: boolean) => isDark ? CATEGORICAL_COLORS.dark : CATEGORICAL_COLORS.light;
const getShadesOfGray = (isDark: boolean) => isDark
  ? ['#f5f4f4', '#d6d3d1', '#a8a29e', '#79716b', '#57534e', '#44403c', '#292524']
  : ['#0c0a09', '#1c1917', '#292524', '#44403c', '#57534e', '#79716b', '#a8a29e'];

const eurFormatter = (value: unknown) => typeof value === 'number'
  ? value.toLocaleString('lt-LT', { style: 'currency', currency: 'EUR' })
  : 'Nėra duomenų';

function buildGlobalDefaults(isDark: boolean) {
  const themeTokens = getThemeTokens(isDark);
  return {
    chart: { toolbar: { show: false }, zoom: { enabled: false }, fontFamily: 'Ubuntu, system-ui, sans-serif', background: 'transparent', height: 350, foreColor: themeTokens.labelColor },
    tooltip: { enabled: true, theme: isDark ? 'dark' : 'light', style: { fontFamily: 'Ubuntu, system-ui, sans-serif' } },
    xaxis: { labels: { style: { colors: themeTokens.labelColor } } },
    yaxis: { labels: { style: { colors: themeTokens.labelColor } } },
    stroke: { curve: 'smooth', width: 2 },
    markers: { size: 4 },
    colors: getCategoricalColors(isDark),
    grid: { borderColor: themeTokens.gridColor },
    theme: { mode: isDark ? 'dark' : 'light' },
    legend: { labels: { colors: themeTokens.labelColor } },
  };
}

const typeChartDefaults: Record<string, any> = {
  'line-datetime': { chart: { type: 'line' }, xaxis: { type: 'datetime', tickAmount: 6, labels: { format: 'yyyy-MM' } }, tooltip: { x: { format: 'yyyy-MM' } } },
  'pie': { chart: { type: 'pie' }, legend: { position: 'bottom' }, dataLabels: { enabled: true } },
  'scatter': { chart: { type: 'scatter' } },
  'treemap': { chart: { type: 'treemap' } },
};

const chartFlagDefaults: Record<string, any> = {
  yEUR: { yaxis: { labels: { formatter: eurFormatter } } },
  yEURMen: { yaxis: { labels: { formatter: (value: unknown) => typeof value === 'number' ? eurFormatter(value) + ' / mėn.' : 'Nėra duomenų' } } },
  yMin0: { yaxis: { min: 0 } },
  yMinAuto: { yaxis: { min: undefined } },
  xYear: { xaxis: { labels: { format: 'yyyy' } }, tooltip: { x: { format: 'yyyy' } } },
  xAxisYearMonth: { xaxis: { type: 'datetime', tickAmount: 6, labels: { format: 'yyyy-MM' } }, tooltip: { x: { format: 'yyyy-MM' } } },
  xAxisDay: { xaxis: { type: 'datetime', tickAmount: 6, labels: { format: 'yyyy-MM-dd' } }, tooltip: { x: { format: 'yyyy-MM-dd' } } },
  xAxisHourMinute: { xaxis: { type: 'datetime', labels: { format: 'HH:mm' } }, tooltip: { x: { format: 'HH:mm' } } },
  numbersWithSpaces: { yaxis: { labels: { formatter: (value: unknown) => typeof value === 'number' ? value.toLocaleString('lt-LT') : 'Nėra duomenų' } } },
  yAxisNoLabel: { yaxis: { labels: { show: false } } },
  noLine: { stroke: { width: 0 }, markers: { size: 6 } },
  statusTimeline: {
    tooltip: { y: { title: { formatter: () => 'Fiksuotas sutrikimas' } } },
    yaxis: { min: 0, max: 2, tickAmount: 1, labels: { formatter: () => '' } },
    colors: ['#FF4560'],
  },
};

function resolveChartColors(data: any, isDark: boolean) {
  if (Array.isArray(data?.customOptions?.colors) && data.customOptions.colors.length > 0) {
    return data.customOptions.colors;
  }

  const flags = data?.flags || [];
  if (flags.includes('50shadesOfGray')) return getShadesOfGray(isDark);

  return getCategoricalColors(isDark);
}

function buildOptions(data: any, isDark: boolean) {
  let options = structuredClone(buildGlobalDefaults(isDark));
  if (data.type && typeChartDefaults[data.type]) options = deepMerge(options, structuredClone(typeChartDefaults[data.type]));
  for (const flag of (data.flags || [])) {
    if (flag === '50shadesOfGray') options = deepMerge(options, { colors: getShadesOfGray(isDark) });
    else if (flag in chartFlagDefaults) options = deepMerge(options, chartFlagDefaults[flag]);
  }
  if (data.type !== 'pie') {
    options.xaxis = options.xaxis || {};
    options.xaxis.categories = data.labels;
    if (Array.isArray(data.series) && (data.series.length === 0 || !data.series[0]?.data)) {
      options.series = [{ name: data.customOptions?.seriesName || '', data: data.series }];
    } else {
      options.series = data.series;
    }
  } else {
    options.labels = data.labels;
    options.series = data.series;
  }
  if (data.customOptions) options = deepMerge(options, data.customOptions);
  return options;
}

function loadApexCharts() {
  if (window.ApexCharts) return Promise.resolve(window.ApexCharts);
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-apexcharts-runtime]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.ApexCharts), { once: true });
      existing.addEventListener('error', reject, { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = '/dist/apexcharts.js';
    script.defer = true;
    script.dataset.apexchartsRuntime = 'true';
    script.onload = () => resolve(window.ApexCharts);
    script.onerror = reject;
    document.body.appendChild(script);
  });
}

export function ensureChartRuntime() {
  if (window.__chartsRuntimePromise) return window.__chartsRuntimePromise;

  window.__chartsRuntimePromise = Promise.resolve().then(() => {
    if (window.__chartsRuntimeInitialized) return;
    window.__chartsRuntimeInitialized = true;

    ensureTooltipStyles();

    let apexPromise: Promise<any> | undefined;
    const renderedCharts: Array<{ chart: any; data: any }> = [];

    window.displayChart = async function displayChart(data: any) {
      if (!data?.element || !data?.labels || !data?.series) return;
      apexPromise ||= loadApexCharts();
      await apexPromise;
      const chart = new window.ApexCharts(data.element, buildOptions(data, getIsDark()));
      chart.render();
      renderedCharts.push({ chart, data });
    };

    const updateAllCharts = () => {
      const isDark = getIsDark();
      const themeTokens = getThemeTokens(isDark);
      for (const { chart, data } of renderedCharts) {
        chart.updateOptions({
          chart: { foreColor: themeTokens.labelColor },
          tooltip: { theme: isDark ? 'dark' : 'light' },
          xaxis: { labels: { style: { colors: themeTokens.labelColor } } },
          yaxis: { labels: { style: { colors: themeTokens.labelColor } } },
          grid: { borderColor: themeTokens.gridColor },
          theme: { mode: isDark ? 'dark' : 'light' },
          legend: { labels: { colors: themeTokens.labelColor } },
          colors: resolveChartColors(data, isDark),
        }, false, true);
      }
    };

    new MutationObserver(updateAllCharts).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if (!document.documentElement.classList.contains('dark')) updateAllCharts();
    });
  });

  return window.__chartsRuntimePromise;
}

if (typeof window !== 'undefined') {
  window.ensureChartRuntime = ensureChartRuntime;
}
