import type { APIRoute } from 'astro'

interface ValidateRequest {
  apiKey: string
}

interface ValidateResponse {
  valid: boolean
  error?: string
  userInfo?: {
    id: string
    email?: string
  }
}

/**
 * Validates a RunPod API key by making a simple API call.
 * Tests the key against RunPod's GraphQL API.
 */
export const POST: APIRoute = async ({ request }) => {
  try {
    const body: ValidateRequest = await request.json()
    const { apiKey } = body

    if (!apiKey || typeof apiKey !== 'string') {
      return new Response(
        JSON.stringify({
          valid: false,
          error: 'API key is required',
        } as ValidateResponse),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Test the API key by fetching user info
    const response = await fetch('https://api.runpod.io/graphql?api_key=' + apiKey, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: `
          query {
            myself {
              id
              email
            }
          }
        `,
      }),
    })

    if (!response.ok) {
      return new Response(
        JSON.stringify({
          valid: false,
          error: `RunPod API returned ${response.status}: ${response.statusText}`,
        } as ValidateResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const data = await response.json()

    // Check for GraphQL errors
    if (data.errors && data.errors.length > 0) {
      const errorMsg = data.errors[0].message || 'Invalid API key'
      return new Response(
        JSON.stringify({
          valid: false,
          error: errorMsg,
        } as ValidateResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // Check if we got user data
    if (data.data?.myself) {
      return new Response(
        JSON.stringify({
          valid: true,
          userInfo: {
            id: data.data.myself.id,
            email: data.data.myself.email,
          },
        } as ValidateResponse),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    }

    // No errors but no user data either
    return new Response(
      JSON.stringify({
        valid: false,
        error: 'Unable to verify API key',
      } as ValidateResponse),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({
        valid: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as ValidateResponse),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    )
  }
}
