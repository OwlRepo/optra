export async function apiFetch(path: string, init?: RequestInit) {
  const res = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  const isEmpty = res.status === 204 || res.status === 205
  const data = isEmpty ? {} : await res.json()
  if (!res.ok) throw data
  return data
}

export async function uploadFile(path: string, file: File) {
  const formData = new FormData()
  formData.append('file', file)

  const res = await fetch(path, {
    method: 'POST',
    body: formData,
  })
  const data = await res.json()
  if (!res.ok) throw data
  return data
}
