import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Floor } from "../api";
import { useBuildings } from "../queries";
import { useI18n } from "../../../i18n";
import { ApiError } from "../../../lib/api-client";
import { boardFormValues, boardInput, BoardFormValues } from "../domain/board-management";
import { boardManagementApi, DistributionBoard } from "./board-management-api";
import "./board-management.css";

type Props = {
  projectId: number;
};

const boardsKey = (projectId: number) => ["projects", projectId, "topology", "boards"] as const;

function flattenFloors(buildings: { name: string; floors: Floor[] }[] | undefined) {
  return buildings?.flatMap((building) => building.floors.map((floor) => ({
    ...floor,
    buildingName: building.name,
  }))) ?? [];
}

export function BoardManagement({ projectId }: Props) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const boards = useQuery({
    queryKey: boardsKey(projectId),
    queryFn: () => boardManagementApi.list(projectId),
  });
  const buildings = useBuildings(projectId);
  const [formOpen, setFormOpen] = useState(false);
  const [editingBoard, setEditingBoard] = useState<DistributionBoard | null>(null);
  const [values, setValues] = useState<BoardFormValues>(() => boardFormValues());
  const [formRevision, setFormRevision] = useState<string | null>(null);

  const refreshBoards = () => {
    void queryClient.invalidateQueries({ queryKey: ["projects", projectId, "floors"] });
    return queryClient.invalidateQueries({ queryKey: boardsKey(projectId) });
  };
  const createBoard = useMutation({
    mutationFn: ({ input, revision }: { input: ReturnType<typeof boardInput>; revision: string }) =>
      boardManagementApi.create(projectId, input, revision),
    onSuccess: () => {
      void refreshBoards();
      closeForm();
    },
  });
  const updateBoard = useMutation({
    mutationFn: ({ board, input, revision }: { board: DistributionBoard; input: ReturnType<typeof boardInput>; revision: string }) =>
      boardManagementApi.update(projectId, board.id, input, revision),
    onSuccess: () => {
      void refreshBoards();
      closeForm();
    },
  });
  const deleteBoard = useMutation({
    mutationFn: ({ boardId, revision }: { boardId: number; revision: string }) =>
      boardManagementApi.delete(projectId, boardId, revision),
    onSuccess: refreshBoards,
  });

  function closeForm() {
    setFormOpen(false);
    setEditingBoard(null);
    setFormRevision(null);
    setValues(boardFormValues());
  }

  function beginCreate() {
    if (!boards.data) return;
    setEditingBoard(null);
    setValues(boardFormValues());
    setFormRevision(boards.data.revision);
    setFormOpen(true);
  }

  function beginEdit(board: DistributionBoard) {
    if (!boards.data) return;
    setEditingBoard(board);
    setValues(boardFormValues(board));
    setFormRevision(boards.data.revision);
    setFormOpen(true);
  }

  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = boardInput(values, editingBoard ?? undefined);
    if (!input.name || formRevision === null) return;
    createBoard.reset();
    updateBoard.reset();
    deleteBoard.reset();
    if (editingBoard) updateBoard.mutate({ board: editingBoard, input, revision: formRevision });
    else createBoard.mutate({ input, revision: formRevision });
  }

  function confirmDelete(board: DistributionBoard) {
    if (!boards.data) return;
    if (window.confirm(t("Delete board “{{name}}”? This will also delete its circuits and loads.", { name: board.name }))) {
      createBoard.reset();
      updateBoard.reset();
      deleteBoard.reset();
      deleteBoard.mutate({ boardId: board.id, revision: boards.data.revision });
    }
  }

  const floors = flattenFloors(buildings.data);
  const floorById = new Map(floors.map((floor) => [floor.id, floor]));
  const isSaving = createBoard.isPending || updateBoard.isPending;
  const mutationError = createBoard.isError || updateBoard.isError || deleteBoard.isError;
  const conflict = [createBoard.error, updateBoard.error, deleteBoard.error]
    .some((error) => error instanceof ApiError && error.status === 409);

  return (
    <section className="board-management" aria-labelledby="board-management-title">
      <header className="board-management__header">
        <div>
          <h3 id="board-management-title">{t("Distribution boards")}</h3>
          <p>{t("Manage project boards and their floor assignment.")}</p>
        </div>
        {!formOpen && <button type="button" className="button-secondary" onClick={beginCreate} disabled={!boards.data || boards.isFetching}>{t("Add board")}</button>}
      </header>

      {boards.isLoading && <p className="board-management__status" role="status">{t("Loading boards…")}</p>}
      {boards.isError && <p className="board-management__error" role="alert">{t("Could not load distribution boards.")}</p>}
      {buildings.isError && <p className="board-management__error" role="alert">{t("Could not load floors. Board floor assignments may be unavailable.")}</p>}
      {mutationError && <p className="board-management__error" role="alert">{conflict
        ? t("Board data changed. Reload the page before reapplying your changes.")
        : t("Could not save this board change. Please try again.")}</p>}
      {deleteBoard.isPending && <p className="board-management__status" role="status">{t("Deleting board…")}</p>}

      {formOpen && (
        <form className="board-management__form" onSubmit={submitForm}>
          <h4>{editingBoard ? t("Edit board") : t("Create board")}</h4>
          <label>
            {t("Board name")}
            <input
              autoFocus
              required
              maxLength={200}
              value={values.name}
              onChange={(event) => setValues((current) => ({ ...current, name: event.target.value }))}
            />
          </label>
          <label>
            {t("Board type")}
            <select
              value={values.kind}
              onChange={(event) => setValues((current) => ({ ...current, kind: event.target.value as BoardFormValues["kind"] }))}
            >
              <option value="main">{t("Main board")}</option>
              <option value="sub">{t("Sub-board")}</option>
            </select>
          </label>
          <label>
            {t("Floor (optional)")}
            <select
              value={values.floorId}
              disabled={buildings.isLoading || buildings.isError}
              onChange={(event) => setValues((current) => ({ ...current, floorId: event.target.value }))}
            >
              <option value="">{t("No floor assigned")}</option>
              {floors.map((floor) => <option key={floor.id} value={floor.id}>{floor.buildingName} · {floor.name}</option>)}
            </select>
          </label>
          <div className="board-management__actions">
            <button type="submit" disabled={isSaving || !values.name.trim()}>{isSaving ? t("Saving…") : t("Save board")}</button>
            <button type="button" className="button-secondary" disabled={isSaving} onClick={closeForm}>{t("Cancel")}</button>
          </div>
        </form>
      )}

      {!boards.isLoading && !boards.isError && (boards.data?.boards.length ?? 0) === 0 && !formOpen && (
        <p className="board-management__empty">{t("No distribution boards yet.")}</p>
      )}

      {boards.data && boards.data.boards.length > 0 && (
        <ul className="board-management__list">
          {boards.data.boards.map((board) => {
            const floor = board.floor_id == null ? null : floorById.get(board.floor_id);
            return (
              <li className="board-management__item" key={board.id}>
                <div className="board-management__details">
                  <strong>{board.name}</strong>
                  <span>{t(board.kind === "main" ? "Main board" : "Sub-board")}</span>
                  <span>{floor ? `${floor.buildingName} · ${floor.name}` : board.floor_id == null ? t("No floor assigned") : t("Assigned floor unavailable")}</span>
                </div>
                <div className="board-management__actions">
                  <button type="button" className="button-secondary" onClick={() => beginEdit(board)} disabled={isSaving || deleteBoard.isPending || boards.isFetching}>{t("Edit")}</button>
                  <button type="button" className="button-secondary board-management__delete" onClick={() => confirmDelete(board)} disabled={deleteBoard.isPending || isSaving || boards.isFetching}>{t("Delete")}</button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
