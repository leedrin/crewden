import { asc, eq } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { Project } from '@crewden/shared';
import { projects } from '../schema.js';
import type { ProjectRepository } from './types.js';

type Database = LibSQLDatabase<typeof import('../schema.js')>;

function toProject(row: typeof projects.$inferSelect): Project {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    paseoProjectId: row.paseoProjectId ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class SqliteProjectRepository implements ProjectRepository {
  constructor(private db: Database) {}

  async list(): Promise<Project[]> {
    const rows = await this.db.select().from(projects).orderBy(asc(projects.createdAt));
    return rows.map(toProject);
  }

  async getById(id: string): Promise<Project | undefined> {
    const [row] = await this.db.select().from(projects).where(eq(projects.id, id)).limit(1);
    return row ? toProject(row) : undefined;
  }

  async getBySlug(slug: string): Promise<Project | undefined> {
    const [row] = await this.db.select().from(projects).where(eq(projects.slug, slug)).limit(1);
    return row ? toProject(row) : undefined;
  }

  async create(input: Omit<Project, 'createdAt' | 'updatedAt'>): Promise<Project> {
    const now = new Date().toISOString();
    const created: Project = { ...input, createdAt: now, updatedAt: now };
    await this.db.insert(projects).values({
      id: created.id,
      name: created.name,
      slug: created.slug,
      description: created.description,
      paseoProjectId: created.paseoProjectId ?? null,
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    return created;
  }

  async update(id: string, patch: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>): Promise<Project | undefined> {
    const existing = await this.getById(id);
    if (!existing) return undefined;
    const updated: Project = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.db.update(projects).set({
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      paseoProjectId: updated.paseoProjectId ?? null,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }).where(eq(projects.id, id));
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const existing = await this.getById(id);
    if (!existing) return false;
    await this.db.delete(projects).where(eq(projects.id, id));
    return true;
  }
}
