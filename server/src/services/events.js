/** In-memory hub for Server-Sent Events, so open dashboards update without refreshing. */
const clients = new Set();

export function addClient(res, user) {
  const client = { res, user };
  clients.add(client);
  return () => clients.delete(client);
}

/** Send an event to connected staff. Landlords only receive events for their own properties. */
export function emit(type, data = {}, ownerId = null) {
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (client.user.role === 'landlord' && client.user.id !== ownerId) continue;
    try {
      client.res.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

export const clientCount = () => clients.size;
