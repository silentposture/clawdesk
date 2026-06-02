import { FolderKanban, Pin, PinOff, Star } from "lucide-react";
import { projectCategories, selectedProject, visibleProjects, type WorkspaceAction, type WorkspaceState } from "../lib/workspaces";
import { useI18n } from "../lib/i18n";

interface WorkspacePanelProps {
  state: WorkspaceState;
  dispatch: (action: WorkspaceAction) => void;
}

export function WorkspacePanel({ state, dispatch }: WorkspacePanelProps): JSX.Element {
  const { t } = useI18n();
  const projects = visibleProjects(state);
  const selected = selectedProject(state);

  return (
    <aside className="workspace-pane">
      <header className="workspace-header">
        <div>
          <span>{t("app.projectPanel.title")}</span>
          <strong>{selected?.name ?? t("app.projectPanel.notSelected")}</strong>
        </div>
        <button
          className={`workspace-pin-filter ${state.showPinnedOnly ? "active" : ""}`}
          type="button"
          aria-label={t("app.projectPanel.filterPinned")}
          onClick={() => dispatch({ type: "toggle-pinned-filter" })}
        >
          <Star size={16} />
        </button>
      </header>

      <nav className="category-list" aria-label={t("app.projectPanel.categories")}>
        {projectCategories.map((category) => (
          <button
            className={state.activeCategory === category ? "active" : ""}
            key={category}
            type="button"
            onClick={() => dispatch({ type: "select-category", category })}
          >
            {category}
          </button>
        ))}
      </nav>

      <section className="project-list" aria-label={t("app.projectPanel.list")}>
        {projects.map((project) => (
          <article className={`project-item ${state.selectedProjectId === project.id ? "selected" : ""}`} key={project.id}>
            <button className="project-main" type="button" onClick={() => dispatch({ type: "select-project", projectId: project.id })}>
              <FolderKanban size={16} />
              <span>
                <strong>{project.name}</strong>
                <small>{project.category} · {project.updatedAt}</small>
              </span>
            </button>
            <button
            className={`project-pin ${project.pinned ? "active" : ""}`}
            type="button"
            aria-label={project.pinned ? t("app.projectPanel.unpin") : t("app.projectPanel.pin")}
            onClick={() => dispatch({ type: "toggle-pin", projectId: project.id })}
          >
              {project.pinned ? <Pin size={15} /> : <PinOff size={15} />}
            </button>
            <p>{project.description}</p>
          </article>
        ))}
      </section>
    </aside>
  );
}
