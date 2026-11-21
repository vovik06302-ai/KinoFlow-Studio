import React, { useState } from 'react';
import { Folder, Plus, Trash2, ChevronRight, Layout } from 'lucide-react';
import { ProjectStorage } from '../services/projectStorage';
import { Project } from '../types/film';

interface ProjectSidebarProps {
  currentProjectId: string | null;
  onProjectSelect: (id: string) => void;
  onProjectCreate: (name: string) => void;
  onProjectDelete: (id: string) => void;
}

export function ProjectSidebar({
  currentProjectId,
  onProjectSelect,
  onProjectCreate,
  onProjectDelete,
}: ProjectSidebarProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const projects = ProjectStorage.getProjects();

  const handleCreate = () => {
    if (!newProjectName.trim()) return;
    onProjectCreate(newProjectName);
    setNewProjectName('');
    setIsAdding(false);
  };

  return (
    <aside className="flex h-full flex-col border-r border-[#262C3A] bg-[#0F121A] w-64 transition-all">
      <div className="p-4 flex items-center justify-between border-b border-[#262C3A]">
        <div className="flex items-center gap-2 text-[#F1F5F9] font-semibold">
          <Layout className="h-4 w-4 text-[#E58E26]" />
          <span>Проекты</span>
        </div>
        <button 
          onClick={() => setIsAdding(true)}
          className="p-1 rounded-md bg-[#E58E26]/10 text-[#E58E26] hover:bg-[#E58E26]/20 transition-colors"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isAdding && (
          <div className="mb-4 p-2 rounded-md bg-[#1A1F2B] border border-[#E58E26]/30">
            <input 
              autoFocus
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="Название фильма..."
              className="w-full bg-transparent border-none outline-none text-xs text-[#F1F5F9] placeholder-[#475569]"
            />
            <div className="mt-2 flex gap-1">
              <button onClick={handleCreate} className="px-2 py-1 text-[10px] bg-[#E58E26] text-black rounded font-medium">Создать</button>
              <button onClick={() => setIsAdding(false)} className="px-2 py-1 text-[10px] text-[#94A3B8] hover:text-white">Отмена</button>
            </div>
          </div>
        )}

        {projects.length === 0 && !isAdding && (
          <div className="text-center py-10 text-xs text-[#475569]">
            Проекты не найдены
          </div>
        )}

        {projects.map((project) => (
          <div 
            key={project.id}
            className={`group flex items-center justify-between p-2 rounded-md cursor-pointer transition-all ${
              currentProjectId === project.id ? 'bg-[#E58E26]/20 text-[#F6AD55]' : 'text-[#94A3B8] hover:bg-[#1A1F2B] hover:text-[#E2E8F0]'
            }`}
            onClick={() => onProjectSelect(project.id)}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Folder className={`h-3.5 w-3.5 ${currentProjectId === project.id ? 'text-[#F6AD55]' : 'text-[#475569]'}`} />
              <span className="text-xs truncate">{project.name}</span>
            </div>
            <button 
              onClick={(e) => { e.stopPropagation(); onProjectDelete(project.id); }}
              className="opacity-0 group-hover:opacity-100 p-1 text-[#EF4444] hover:bg-[#7F1D1D]/20 rounded transition-all"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </aside>
  );
}
