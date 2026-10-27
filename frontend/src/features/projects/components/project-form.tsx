import { useForm } from "@tanstack/react-form";
import { useCreateProject } from "../queries";

export function ProjectForm() {
  const createProject = useCreateProject();

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
    },
    onSubmit: async ({ value }) => {
      await createProject.mutateAsync(value);
      form.reset();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      style={{ display: "grid", gap: 8, maxWidth: 560 }}
    >
      <input
        placeholder="Project name"
        value={form.state.values.name}
        onChange={(e) => form.setFieldValue("name", e.target.value)}
      />
      <textarea
        placeholder="Description"
        rows={4}
        value={form.state.values.description}
        onChange={(e) => form.setFieldValue("description", e.target.value)}
      />
      <button type="submit" disabled={createProject.isPending}>
        {createProject.isPending ? "Creating..." : "Create project"}
      </button>
    </form>
  );
}
