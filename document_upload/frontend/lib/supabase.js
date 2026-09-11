// Thin fetch helpers around Supabase's REST + Edge Functions.
// All PostgREST reads carry an X-Client-Id header that the row-level security
// policies (anon_read_own_audits, require_client_id) read via
// current_setting('request.headers', true)::json->>'x-client-id' to scope rows
// to the caller's client.

// Supabase publishable keys (sb_publishable_*) and legacy anon JWTs both work
// here: the apikey + Authorization headers are accepted in the same shape.
function authHeaders(apiKey, clientId) {
    return {
        apikey: apiKey,
        Authorization: `Bearer ${apiKey}`,
        'X-Client-Id': clientId,
    };
}

export async function pgRestSelect({
    supabaseUrl,
    apiKey,
    clientId,
    table,
    query,
}) {
    const url = `${supabaseUrl}/rest/v1/${table}${query ? `?${query}` : ''}`;
    const res = await fetch(url, {
        method: 'GET',
        headers: {
            ...authHeaders(apiKey, clientId),
            Accept: 'application/json',
        },
    });
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`PostgREST ${res.status}: ${body}`);
    }
    return res.json();
}

export async function pgRestCount({
    supabaseUrl,
    apiKey,
    clientId,
    table,
    filter = '',
}) {
    const url = `${supabaseUrl}/rest/v1/${table}?select=*${filter ? `&${filter}` : ''}`;
    const res = await fetch(url, {
        method: 'HEAD',
        headers: {
            ...authHeaders(apiKey, clientId),
            Prefer: 'count=exact',
        },
    });
    if (!res.ok) {
        throw new Error(`PostgREST ${res.status}`);
    }
    const range = res.headers.get('content-range') || '';
    const m = range.match(/\/(\d+|\*)$/);
    return m && m[1] !== '*' ? parseInt(m[1], 10) : 0;
}

export async function callEdgeFunction({
    supabaseUrl,
    apiKey,
    clientId,
    name,
    body,
}) {
    const res = await fetch(`${supabaseUrl}/functions/v1/${name}`, {
        method: 'POST',
        headers: {
            ...authHeaders(apiKey, clientId),
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    let payload;
    try {
        payload = await res.json();
    } catch {
        payload = null;
    }
    if (!res.ok) {
        const msg = payload?.error || `Erreur ${res.status}`;
        const err = new Error(msg);
        err.status = res.status;
        err.payload = payload;
        throw err;
    }
    return payload;
}

export async function uploadToSignedUrl({signedUrl, file, contentType, onProgress}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', signedUrl, true);
        xhr.setRequestHeader('Content-Type', contentType);
        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) onProgress(e.loaded / e.total);
            });
        }
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else reject(new Error(`Upload ${xhr.status}: ${xhr.responseText}`));
        };
        xhr.onerror = () => reject(new Error('Erreur réseau pendant l\'upload'));
        xhr.send(file);
    });
}
