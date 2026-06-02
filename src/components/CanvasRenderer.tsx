import { Activity, CheckCircle2, CircleDot, Gauge, ListChecks, Table2 } from "lucide-react";
import type { CanvasComponent } from "../lib/events";
import type { CanvasSurface } from "../lib/canvas";
import { useI18n } from "../lib/i18n";

interface CanvasRendererProps {
  surface?: CanvasSurface;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function asRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is Record<string, unknown> => !!row && typeof row === "object");
}

function renderComponent(component: CanvasComponent, surface: CanvasSurface): JSX.Element {
  const props = component.props;

  if (component.type === "Panel") {
    return (
      <section className="canvas-panel" key={component.id}>
        {props.title ? <h3>{asString(props.title)}</h3> : null}
        <div className="canvas-panel-body">
          {(component.children ?? []).map((childId) => {
            const child = surface.components[childId];
            return child ? renderComponent(child, surface) : null;
          })}
        </div>
      </section>
    );
  }

  if (component.type === "Text") {
    return (
      <p className="canvas-text" key={component.id}>
        {asString(props.text)}
      </p>
    );
  }

  if (component.type === "Metric") {
    return (
      <div className="metric" key={component.id}>
        <Gauge size={18} />
        <span>{asString(props.label)}</span>
        <strong>{asString(props.value)}</strong>
      </div>
    );
  }

  if (component.type === "Progress") {
    const value = Math.max(0, Math.min(100, asNumber(props.value)));
    return (
      <div className="progress-block" key={component.id}>
        <div className="progress-label">
          <span>{asString(props.label)}</span>
          <span>{value}%</span>
        </div>
        <div className="progress-track">
          <div style={{ width: `${value}%` }} />
        </div>
      </div>
    );
  }

  if (component.type === "List") {
    return (
      <ul className="canvas-list" key={component.id}>
        {asStringArray(props.items).map((item) => (
          <li key={item}>
            <CheckCircle2 size={16} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (component.type === "Table") {
    const rows = asRows(props.rows);
    const columns = asStringArray(props.columns);
    return (
      <div className="table-wrap" key={component.id}>
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {columns.map((column) => (
                  <td key={column}>{String(row[column] ?? "")}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <button className="canvas-action" key={component.id} type="button">
      <CircleDot size={16} />
      {asString(props.label, "動作")}
    </button>
  );
}

export function CanvasRenderer({ surface }: CanvasRendererProps): JSX.Element {
  const { t } = useI18n();
  if (!surface || !surface.rootId) {
    return (
      <div className="empty-canvas">
        <Activity size={28} />
        <h2>{t("canvas.emptyTitle")}</h2>
        <p>{t("canvas.emptyBody")}</p>
      </div>
    );
  }

  const root = surface.components[surface.rootId];

  return (
    <div className="canvas-content">
      <div className="canvas-heading">
        <Table2 size={18} />
        <span>{surface.title}</span>
      </div>
      {root ? renderComponent(root, surface) : null}
    </div>
  );
}
