import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from '@tauri-apps/api/event';
import "./TodoWindow.css";


type TodoItem = {
    id: string;
    content: string;
    completed: boolean;
    created_at: number;
};

export default function TodoWindow() {
    const [date, setDate] = useState<string>("");
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [newTodoContent, setNewTodoContent] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        // 从URL参数获取日期
        const urlParams = new URLSearchParams(window.location.search);
        const dateParam = urlParams.get('date');

        if (dateParam) {
            setDate(dateParam);
            loadTodos(dateParam);
        } else {
            // 监听从主窗口发送的日期数据
            const unlisten = listen('set-todo-date', (event: any) => {
                const { date: eventDate } = event.payload;
                setDate(eventDate);
                loadTodos(eventDate);
            });

            // 清理监听器
            return () => {
                unlisten.then(fn => fn());
            };
        }
    }, []);

    const loadTodos = async (dateStr: string) => {
        setIsLoading(true);
        try {
            const todoList = await invoke<TodoItem[]>('get_todos_for_date', { date: dateStr });
            const sortedTodos = todoList.sort((a, b) => {
                if (a.completed !== b.completed) {
                    return a.completed ? 1 : -1;
                }
                return a.created_at - b.created_at;
            });
            setTodos(sortedTodos);
        } catch (error) {
            console.error('加载待办失败:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const saveTodos = async (updatedTodos: TodoItem[]) => {
        try {
            await invoke('save_todos_for_date', { date, todos: updatedTodos });
            // 通知主窗口刷新
            await invoke('refresh_calendar_data');
        } catch (error) {
            console.error('保存待办失败:', error);
        }
    };

    const addTodo = async () => {
        if (!newTodoContent.trim()) return;

        const newTodo: TodoItem = {
            id: Date.now().toString(),
            content: newTodoContent.trim(),
            completed: false,
            created_at: Date.now()
        };

        const updatedTodos = [...todos, newTodo];
        setTodos(updatedTodos);
        setNewTodoContent("");
        await saveTodos(updatedTodos);
    };

    const toggleTodoComplete = async (todoId: string) => {
        const updatedTodos = todos.map(todo => {
            if (todo.id === todoId) {
                return { ...todo, completed: !todo.completed };
            }
            return todo;
        }).sort((a, b) => {
            if (a.completed !== b.completed) {
                return a.completed ? 1 : -1;
            }
            return a.created_at - b.created_at;
        });

        setTodos(updatedTodos);
        await saveTodos(updatedTodos);
    };

    const deleteTodo = async (todoId: string) => {
        const updatedTodos = todos.filter(todo => todo.id !== todoId);
        setTodos(updatedTodos);
        await saveTodos(updatedTodos);
    };

    const handleClose = async () => {
        const window = getCurrentWindow();
        await window.close();
    };

    // ... 其余代码保持不变，formatDate函数修复：
    const formatDate = (dateStr: string): string => {
        if (!dateStr) return "未知日期";

        try {
            const date = new Date(dateStr + 'T00:00:00');
            const weekdays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
            const weekday = weekdays[date.getDay()];
            return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
        } catch (error) {
            console.error('日期格式化失败:', dateStr, error);
            return dateStr;
        }
    };

    const completedTodos = todos.filter(t => t.completed);
    const pendingTodos = todos.filter(t => !t.completed);

    return (
        <div className="todo-container">
            <div className="todo-header" data-tauri-drag-region>
                <div className="header-left">
                    <h1 className="todo-title">{formatDate(date)}</h1>
                    <div className="todo-stats">
                        <span className="pending-count">待办: {pendingTodos.length}</span>
                        <span className="completed-count">已完成: {completedTodos.length}</span>
                    </div>
                </div>
                <button className="close-button" onClick={handleClose}>
                    <div className="close-icon"></div>
                </button>
            </div>

            <div className="todo-content">
                {isLoading ? (
                    <div className="loading">加载中...</div>
                ) : (
                    <>
                        {/* 未完成的待办 */}
                        <div className="todo-section pending-section">
                            {pendingTodos.map(todo => (
                                <div key={todo.id} className="todo-item pending">
                                    <button
                                        className="todo-checkbox"
                                        onClick={() => toggleTodoComplete(todo.id)}
                                    >
                                        <div className="checkbox-inner"></div>
                                    </button>
                                    <div className="todo-content-text">{todo.content}</div>
                                    <button
                                        className="todo-delete"
                                        onClick={() => deleteTodo(todo.id)}
                                        title="删除"
                                    >
                                        <div className="delete-icon"></div>
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* 已完成的待办 */}
                        {completedTodos.length > 0 && (
                            <div className="todo-section completed-section">
                                <div className="section-divider">
                                    <span>已完成</span>
                                </div>
                                {completedTodos.map(todo => (
                                    <div key={todo.id} className="todo-item completed">
                                        <button
                                            className="todo-checkbox checked"
                                            onClick={() => toggleTodoComplete(todo.id)}
                                        >
                                            <div className="checkbox-inner">✓</div>
                                        </button>
                                        <div className="todo-content-text">{todo.content}</div>
                                        <button
                                            className="todo-delete"
                                            onClick={() => deleteTodo(todo.id)}
                                            title="删除"
                                        >
                                            <div className="delete-icon"></div>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* 添加新待办 */}
                        <div className="add-todo-section">
                            <div className="add-todo-input">
                                <button className="add-button-icon">+</button>
                                <input
                                    type="text"
                                    value={newTodoContent}
                                    onChange={(e) => setNewTodoContent(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && addTodo()}
                                    placeholder="添加新的待办事项..."
                                    className="new-todo-input"
                                />
                                <button
                                    className="add-todo-button"
                                    onClick={addTodo}
                                    disabled={!newTodoContent.trim()}
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
