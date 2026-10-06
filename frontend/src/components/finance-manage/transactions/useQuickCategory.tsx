import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { createCategory, createCategoryGroup, type Category, type CategoryGroup } from "../../../lib/api";
import { QuickCategoryDialog } from "./QuickCategoryDialog";

/**
 * Alta rápida de grupo/categoría sin salir del formulario que la necesita.
 * `onCreated` recibe la categoría nueva para que el formulario abierto la deje
 * seleccionada. Devuelve el diálogo ya montado y la función para abrirlo.
 */
export function useQuickCategory(groups: CategoryGroup[], onCreated?: (category: Category) => void) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newCategoryGroupId, setNewCategoryGroupId] = useState<number | "">("");
  const [newCategoryName, setNewCategoryName] = useState("");

  const createGroupMut = useMutation({
    mutationFn: createCategoryGroup,
    onSuccess: (group) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      setNewGroupName("");
      setNewCategoryGroupId(group.id);
      toast.success("Grupo creado");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const createCategoryMut = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      queryClient.invalidateQueries({ queryKey: ["budgets"] });
      setNewCategoryName("");
      setNewCategoryGroupId(category.groupId);
      onCreated?.(category);
      setOpen(false);
      toast.success("Categoría creada");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleCreateGroup = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) { toast.error("Escribe un nombre de grupo"); return; }
    createGroupMut.mutate({ name: newGroupName.trim() });
  };

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryGroupId || !newCategoryName.trim()) { toast.error("Selecciona un grupo y escribe un nombre"); return; }
    createCategoryMut.mutate({ groupId: Number(newCategoryGroupId), name: newCategoryName.trim() });
  };

  const dialog = (
    <QuickCategoryDialog
      open={open}
      onClose={() => setOpen(false)}
      groups={groups}
      newGroupName={newGroupName}
      setNewGroupName={setNewGroupName}
      newCategoryGroupId={newCategoryGroupId}
      setNewCategoryGroupId={setNewCategoryGroupId}
      newCategoryName={newCategoryName}
      setNewCategoryName={setNewCategoryName}
      onCreateGroup={handleCreateGroup}
      onCreateCategory={handleCreateCategory}
      creatingGroup={createGroupMut.isPending}
      creatingCategory={createCategoryMut.isPending}
    />
  );

  return { openDialog: () => setOpen(true), dialog };
}
