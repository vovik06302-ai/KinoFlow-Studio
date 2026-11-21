import { Project, Scene, Generation } from '../types/film';

const STORAGE_KEY = 'kinoflow_projects';

export class ProjectStorage {
  private static save(projects: Project[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  }

  static getProjects(): Project[] {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  }

  static createProject(name: string, description: string): Project {
    const projects = this.getProjects();
    const newProject: Project = {
      id: `proj_${Date.now()}`,
      name,
      description,
      scenes: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    projects.push(newProject);
    this.save(projects);
    return newProject;
  }

  static addSceneToProject(projectId: string, scene: Scene) {
    const projects = this.getProjects();
    const project = projects.find(p => p.id === projectId);
    if (project) {
      project.scenes.push(scene);
      project.updatedAt = Date.now();
      this.save(projects);
    }
  }

  static addGenerationToScene(projectId: string, sceneId: string, gen: Generation) {
    const projects = this.getProjects();
    const project = projects.find(p => p.id === projectId);
    const scene = project?.scenes.find(s => s.id === sceneId);
    if (scene) {
      scene.generations.push(gen);
      project!.updatedAt = Date.now();
      this.save(projects);
    }
  }

  static deleteProject(projectId: string) {
    const projects = this.getProjects().filter(p => p.id !== projectId);
    this.save(projects);
  }
}
