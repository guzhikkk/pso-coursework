import {
  Activity,
  Gauge,
  GitCompare,
  Moon,
  Sun,
  Wifi,
  WifiOff,
} from 'lucide-react';
import type { AppTab, ThemeMode } from '../types/api';
import './Header.css';

export type BackendStatus = 'checking' | 'online' | 'offline';

interface HeaderProps {
  activeTab: AppTab;
  onTabChange: (tab: AppTab) => void;
  theme: ThemeMode;
  onToggleTheme: () => void;
  backendStatus: BackendStatus;
}

const TABS: Array<{ id: AppTab; label: string; icon: typeof Activity }> = [
  { id: 'simulator', label: 'Симулятор PSO', icon: Activity },
  { id: 'compare', label: 'Сравнение модификаций', icon: GitCompare },
  { id: 'scale', label: 'Масштабирование', icon: Gauge },
];

function HoneycombLogo() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 2 16.5 4.6 16.5 9.8 12 12.4 7.5 9.8 7.5 4.6" fill="currentColor" fillOpacity="0.22" />
      <polygon points="7.5 9.8 12 12.4 12 17.6 7.5 20.2 3 17.6 3 12.4" />
      <polygon points="16.5 9.8 21 12.4 21 17.6 16.5 20.2 12 17.6 12 12.4" />
    </svg>
  );
}

export function Header({
  activeTab,
  onTabChange,
  theme,
  onToggleTheme,
  backendStatus,
}: HeaderProps) {
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <HoneycombLogo />
          </div>
          <div>
            <h1 className="brand-title">PSO Visualizer</h1>
            <p className="brand-subtitle">Исследование метода роя частиц</p>
          </div>
        </div>

        <nav className="nav-tabs" aria-label="Разделы приложения">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                className={`nav-tab${isActive ? ' active' : ''}`}
                onClick={() => onTabChange(tab.id)}
              >
                <Icon size={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="header-actions">
          {backendStatus === 'online' && (
            <span className="badge badge-success" title="Сервер Flask подключён">
              <Wifi size={13} />
              <span>API онлайн</span>
            </span>
          )}
          {backendStatus === 'offline' && (
            <span className="badge badge-danger" title="Не удалось подключиться к Flask API">
              <WifiOff size={13} />
              <span>API недоступен</span>
            </span>
          )}
          {backendStatus === 'checking' && (
            <span className="badge">Проверка API...</span>
          )}

          <button
            type="button"
            className="btn theme-btn"
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Переключить на светлую тему' : 'Переключить на тёмную тему'}
            aria-label="Переключить тему оформления"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}