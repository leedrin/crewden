import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { resetStore } from '../src/db.js';

describe('projects API', () => {
  beforeEach(async () => {
    process.env.CREWDEN_BROWSER_AUTH_TOKEN = 'test-token';
    await resetStore();
  });

  it('lists the default project and can create a project', async () => {
    const app = await buildApp();
    const authHeader = createBrowserAuthHeader();
    const initial = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeader });
    expect(initial.statusCode).toBe(200);
    const initialProjects = initial.json() as Array<{ id: string }>;
    expect(initialProjects.some((project) => project.id === 'default')).toBe(true);

    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader,
      payload: { name: 'Mobile App', slug: 'mobile-app' },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json() as { id: string; slug: string };
    expect(project.slug).toBe('mobile-app');

    const listed = await app.inject({ method: 'GET', url: '/api/projects', headers: authHeader });
    expect(listed.statusCode).toBe(200);
    const projects = listed.json() as Array<{ id: string }>;
    expect(projects.some((item) => item.id === project.id)).toBe(true);

    await app.close();
  });

  it('blocks deletion for non-empty projects', async () => {
    const app = await buildApp();
    const authHeader = createBrowserAuthHeader();
    const created = await app.inject({
      method: 'POST',
      url: '/api/projects',
      headers: authHeader,
      payload: { name: 'Backend', slug: 'backend' },
    });
    expect(created.statusCode).toBe(201);
    const project = created.json() as { id: string };

    const channel = await app.inject({
      method: 'POST',
      url: '/api/channels',
      headers: authHeader,
      payload: { name: 'backend-dev', projectId: project.id },
    });
    expect(channel.statusCode).toBe(201);

    const blockedDelete = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${project.id}`,
      headers: authHeader,
    });
    expect(blockedDelete.statusCode).toBe(409);

    await app.close();
  });
});

function createBrowserAuthHeader() {
  return { authorization: `Bearer ${process.env.CREWDEN_BROWSER_AUTH_TOKEN ?? 'test-token'}` };
}
