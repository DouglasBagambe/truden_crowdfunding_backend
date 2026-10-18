import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { SavedProjectsService } from './saved-projects.service';
const id = '507f1f77bcf86cd799439011';
const user = '507f1f77bcf86cd799439012';
function fixture() {
  const projects = {
    getProjectPublic: jest.fn(),
    getProjectOwnerView: jest.fn(),
  };
  const saved = {
    exists: jest.fn().mockResolvedValue(true),
    updateOne: jest.fn(),
  };
  const service = new SavedProjectsService(saved as never, projects as never);
  return { projects, saved, service };
}
describe('Saved campaign owner visibility', () => {
  it('loads saved state for a private owner campaign through authorized owner fallback', async () => {
    const c = fixture();
    c.projects.getProjectPublic.mockRejectedValue(new NotFoundException());
    c.projects.getProjectOwnerView.mockResolvedValue({});
    await expect(c.service.get(user, id)).resolves.toEqual({ saved: true });
    expect(c.projects.getProjectOwnerView).toHaveBeenCalledWith(id, user);
  });
  it('does not expose a private campaign to another user', async () => {
    const c = fixture();
    c.projects.getProjectPublic.mockRejectedValue(new NotFoundException());
    c.projects.getProjectOwnerView.mockRejectedValue(new ForbiddenException());
    await expect(c.service.get(user, id)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(c.saved.exists).not.toHaveBeenCalled();
  });
  it('preserves API failures rather than hiding them with an owner fallback', async () => {
    const c = fixture();
    c.projects.getProjectPublic.mockRejectedValue(
      new Error('database unavailable'),
    );
    await expect(c.service.get(user, id)).rejects.toThrow(
      'database unavailable',
    );
    expect(c.projects.getProjectOwnerView).not.toHaveBeenCalled();
  });
});
