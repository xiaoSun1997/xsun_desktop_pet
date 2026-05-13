<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";

interface TodoItem {
  id: string;
  content: string;
  completed: boolean;
  created_at: number;
}

const date = ref("");
const todos = ref<TodoItem[]>([]);
const newTodoContent = ref("");
const isLoading = ref(false);

onMounted(() => {
  const urlParams = new URLSearchParams(window.location.search);
  const dateParam = urlParams.get("date");

  if (dateParam) {
    date.value = dateParam;
    loadTodos(dateParam);
  } else {
    let unlistenFn: (() => void) | undefined;
    listen<{ date: string }>("set-todo-date", (event) => {
      date.value = event.payload.date;
      loadTodos(event.payload.date);
    }).then((fn) => {
      unlistenFn = fn;
    });
    onUnmounted(() => {
      if (unlistenFn) unlistenFn();
    });
  }
});

const loadTodos = async (dateStr: string) => {
  isLoading.value = true;
  try {
    const todoList = await invoke<TodoItem[]>("get_todos_for_date", { date: dateStr });
    todos.value = todoList.sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.created_at - b.created_at;
    });
  } catch (error) {
    console.error("Load todos failed:", error);
  } finally {
    isLoading.value = false;
  }
};

const saveTodos = async (updatedTodos: TodoItem[]) => {
  try {
    await invoke("save_todos_for_date", { date: date.value, todos: updatedTodos });
    await invoke("refresh_calendar_data");
  } catch (error) {
    console.error("Save todos failed:", error);
  }
};

const addTodo = async () => {
  if (!newTodoContent.value.trim()) return;
  const newTodo: TodoItem = {
    id: Date.now().toString(),
    content: newTodoContent.value.trim(),
    completed: false,
    created_at: Date.now(),
  };
  const updatedTodos = [...todos.value, newTodo];
  todos.value = updatedTodos;
  newTodoContent.value = "";
  await saveTodos(updatedTodos);
};

const toggleTodoComplete = async (todoId: string) => {
  todos.value = todos.value
    .map((todo: TodoItem) => (todo.id === todoId ? { ...todo, completed: !todo.completed } : todo))
    .sort((a: TodoItem, b: TodoItem) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return a.created_at - b.created_at;
    });
  await saveTodos(todos.value);
};

const deleteTodo = async (todoId: string) => {
  todos.value = todos.value.filter((todo: TodoItem) => todo.id !== todoId);
  await saveTodos(todos.value);
};

const handleClose = async () => {
  const window = getCurrentWindow();
  await window.close();
};

const formatDate = (dateStr: string): string => {
  if (!dateStr) return "Unknown";
  try {
    const d = new Date(dateStr + "T00:00:00");
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${weekdays[d.getDay()]}`;
  } catch {
    return dateStr;
  }
};

const completedTodos = (): TodoItem[] => todos.value.filter((t: TodoItem) => t.completed);
const pendingTodos = (): TodoItem[] => todos.value.filter((t: TodoItem) => !t.completed);
</script>

<template>
  <div class="todo-container">
    <div class="todo-header" data-tauri-drag-region>
      <div class="header-left">
        <h1 class="todo-title">{{ formatDate(date) }}</h1>
        <div class="todo-stats">
          <span class="pending-count">Pending: {{ pendingTodos().length }}</span>
          <span class="completed-count">Done: {{ completedTodos().length }}</span>
        </div>
      </div>
      <button class="close-button" @click="handleClose"><div class="close-icon"></div></button>
    </div>

    <div class="todo-content">
      <div v-if="isLoading" class="loading">Loading...</div>
      <template v-else>
        <div class="todo-section pending-section">
          <div v-for="todo in pendingTodos()" :key="todo.id" class="todo-item pending">
            <button class="todo-checkbox" @click="toggleTodoComplete(todo.id)">
              <div class="checkbox-inner"></div>
            </button>
            <div class="todo-content-text">{{ todo.content }}</div>
            <button class="todo-delete" @click="deleteTodo(todo.id)" title="Delete"><div class="delete-icon"></div></button>
          </div>
        </div>

        <div v-if="completedTodos().length > 0" class="todo-section completed-section">
          <div class="section-divider"><span>Completed</span></div>
          <div v-for="todo in completedTodos()" :key="todo.id" class="todo-item completed">
            <button class="todo-checkbox checked" @click="toggleTodoComplete(todo.id)">
              <div class="checkbox-inner">v</div>
            </button>
            <div class="todo-content-text">{{ todo.content }}</div>
            <button class="todo-delete" @click="deleteTodo(todo.id)" title="Delete"><div class="delete-icon"></div></button>
          </div>
        </div>

        <div class="add-todo-section">
          <div class="add-todo-input">
            <button class="add-button-icon">+</button>
            <input
              type="text"
              v-model="newTodoContent"
              @keypress.enter="addTodo"
              placeholder="Add new todo..."
              class="new-todo-input"
            />
            <button class="add-todo-button" @click="addTodo" :disabled="!newTodoContent.trim()">Add</button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.todo-container { display: flex; flex-direction: column; height: 100vh; background: #1a1a2e; color: #e0e0e0; }
.todo-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #16213e; border-bottom: 1px solid rgba(255,255,255,0.08); cursor: grab; }
.header-left { display: flex; flex-direction: column; gap: 4px; }
.todo-title { font-size: 16px; font-weight: 600; margin: 0; color: #fff; }
.todo-stats { display: flex; gap: 12px; font-size: 11px; color: rgba(255,255,255,0.5); }
.close-button { background: none; border: none; color: rgba(255,255,255,0.5); cursor: pointer; padding: 4px; }
.close-icon { width: 12px; height: 12px; }
.todo-content { flex: 1; overflow-y: auto; padding: 12px 16px; }
.loading { display: flex; align-items: center; justify-content: center; height: 100%; color: rgba(255,255,255,0.5); }
.todo-section { margin-bottom: 12px; }
.todo-item { display: flex; align-items: center; gap: 10px; padding: 8px 10px; background: rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 4px; }
.todo-checkbox { width: 20px; height: 20px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.3); background: transparent; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0; padding: 0; }
.todo-checkbox.checked { background: #27ae60; border-color: #27ae60; }
.checkbox-inner { color: #fff; font-size: 12px; }
.todo-content-text { flex: 1; font-size: 14px; }
.todo-item.completed .todo-content-text { text-decoration: line-through; color: rgba(255,255,255,0.4); }
.todo-delete { background: none; border: none; color: rgba(255,255,255,0.3); cursor: pointer; padding: 4px; opacity: 0; transition: opacity 0.15s; }
.todo-item:hover .todo-delete { opacity: 1; }
.delete-icon { width: 12px; height: 12px; }
.section-divider { display: flex; align-items: center; gap: 8px; padding: 8px 0; font-size: 11px; color: rgba(255,255,255,0.3); }
.section-divider::after { content: ''; flex: 1; height: 1px; background: rgba(255,255,255,0.08); }
.add-todo-section { padding: 8px 0; }
.add-todo-input { display: flex; align-items: center; gap: 8px; background: rgba(255,255,255,0.05); border-radius: 8px; padding: 4px 8px; }
.add-button-icon { background: none; border: none; color: #e94560; font-size: 20px; cursor: pointer; padding: 0 4px; }
.new-todo-input { flex: 1; background: transparent; border: none; color: #e0e0e0; font-size: 14px; outline: none; }
.add-todo-button { padding: 6px 16px; background: #e94560; border: none; border-radius: 6px; color: #fff; cursor: pointer; font-size: 12px; }
.add-todo-button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
