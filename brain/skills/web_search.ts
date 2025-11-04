/**
 * web_search Skill
 * Perform a web search via DuckDuckGo instant answer API and return results
 */

import { URLSearchParams } from 'node:url'
import { SkillManifest, SkillResult } from '../../packages/core/src/skills'
import { execute as httpGet, NETWORK_CONFIG } from './http_get'

export const manifest: SkillManifest = {
  id: 'web_search',
  name: 'Web Search',
  description: 'Search the public web for information and return summarized results',
  category: 'network',

  inputs: {
    query: {
      type: 'string',
      required: true,
      description: 'Search query text',
    },
    maxResults: {
      type: 'number',
      required: false,
      description: 'Maximum number of web results to return (default: 5)',
    },
  },

  outputs: {
    results: {
      type: 'array',
      description: 'Array of web results with titles, snippets, and URLs',
    },
    source: { type: 'string', description: 'Search provider used' },
  },

  risk: 'medium',
  cost: 'expensive',
  minTrustLevel: 'supervised_auto',
  requiresApproval: false,
}

type WebResult = {
  title: string
  url: string
  snippet: string
  image?: string
  deepLinks?: Array<{ title: string; url: string }>
}

export async function execute(inputs: { query: string; maxResults?: number }): Promise<SkillResult> {
  const query = inputs.query?.trim()
  if (!query) {
    return { success: false, error: 'Query is required' }
  }

  const limit = Math.max(1, Math.min(inputs.maxResults ?? 5, 10))

  const collectResults: WebResult[] = []

  const braveKey = process.env.BRAVE_SEARCH_API_KEY?.trim() || NETWORK_CONFIG.apiKeys?.braveSearch || ''
  if (braveKey) {
    const braveParams = new URLSearchParams({
      q: query,
      count: String(limit),
      search_lang: 'en',
    })
    const braveUrl = `https://api.search.brave.com/res/v1/web/search?${braveParams.toString()}`
    const braveResponse = await httpGet({
      url: braveUrl,
      expectJson: true,
      headers: {
        'x-subscription-token': braveKey,
        Accept: 'application/json',
      },
    })
    if (braveResponse.success) {
      const body = (braveResponse.outputs as any)?.body ?? {}
      const items = body?.web?.results
      if (Array.isArray(items)) {
        for (const item of items) {
          if (collectResults.length >= limit) break
          if (!item) continue
          const title = item.title || item.url
          const url = item.url
          const snippet = item.description || ''
          const image = typeof item.thumbnail === 'string' ? item.thumbnail : item.thumbnail?.src
          const deepLinks: Array<{ title: string; url: string }> = []
          const possibleLinkFields = ['more_results', 'deep_results', 'related_results', 'sitelinks', 'extra_links']
          for (const field of possibleLinkFields) {
            const entries = (item as any)[field]
            if (Array.isArray(entries)) {
              for (const entry of entries) {
                if (deepLinks.length >= 4) break
                if (!entry) continue
                const dlTitle = entry.title || entry.text || entry.label || entry.url
                const dlUrl = entry.url || entry.link
                if (dlTitle && dlUrl) {
                  deepLinks.push({ title: String(dlTitle), url: String(dlUrl) })
                }
              }
            }
            if (deepLinks.length >= 4) break
          }
          if (title && url) {
            collectResults.push({
              title: String(title),
              url: String(url),
              snippet: String(snippet),
              image: image ? String(image) : undefined,
              deepLinks: deepLinks.length ? deepLinks : undefined,
            })
          }
        }
      }
      if (collectResults.length) {
        return {
          success: true,
          outputs: {
            results: collectResults.slice(0, limit),
            source: 'brave',
          },
        }
      }
    }
  }

  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    no_redirect: '1',
  })

  const url = `https://api.duckduckgo.com/?${params.toString()}`

  const result = await httpGet({ url, expectJson: true })
  if (!result.success) {
    return result
  }

  const body = (result.outputs as any)?.body ?? {}

  const addResult = (options: { title: string; url: string; snippet?: string; image?: string; deepLinks?: Array<{ title: string; url: string }> }) => {
    const { title, url, snippet, image, deepLinks } = options
    if (!title || !url) return
    collectResults.push({
      title: String(title),
      url: String(url),
      snippet: snippet ? String(snippet) : '',
      image: image ? String(image) : undefined,
      deepLinks: Array.isArray(deepLinks) && deepLinks.length ? deepLinks : undefined,
    })
  }

  try {
    if (Array.isArray(body?.RelatedTopics)) {
      for (const topic of body.RelatedTopics) {
        if (collectResults.length >= limit) break
        if (topic && typeof topic === 'object') {
          if (Array.isArray(topic.Topics)) {
            for (const sub of topic.Topics) {
              if (collectResults.length >= limit) break
              if (sub && typeof sub === 'object' && sub.FirstURL && sub.Text) {
                addResult({
                  title: sub.Text.split(' - ')[0] ?? sub.Text,
                  url: sub.FirstURL,
                  snippet: sub.Text,
                  image: sub.Icon?.URL,
                })
              }
            }
          } else if (topic.FirstURL && topic.Text) {
            addResult({
              title: topic.Text.split(' - ')[0] ?? topic.Text,
              url: topic.FirstURL,
              snippet: topic.Text,
              image: topic.Icon?.URL,
            })
          }
        }
      }
    }

    if (collectResults.length < limit && body?.AbstractText && body?.AbstractURL) {
      addResult({
        title: body.Heading || query,
        url: body.AbstractURL,
        snippet: body.AbstractText,
        image: body.Image || body.Icon?.URL,
      })
    }

    if (collectResults.length === 0) {
      const fallback = await httpGet({ url: 'https://api.thecatapi.com/v1/images/search', expectJson: true }).catch(() => null)
      if (fallback?.success) {
        const bodyArr = Array.isArray((fallback.outputs as any)?.body) ? (fallback.outputs as any).body : []
        const items = bodyArr.map((item: any) => ({
          title: item?.breeds?.[0]?.name || 'Cute kitten',
          url: item?.url || '',
          snippet: item?.id ? `Image ID: ${item.id}` : 'Fallback kitten image from TheCatAPI',
          image: item?.url || '',
        })).filter((item: WebResult) => item.url)
        if (items.length) {
          return {
            success: true,
            outputs: {
              results: items.slice(0, limit),
              source: 'thecatapi-fallback',
            },
          }
        }
      }
      return { success: true, outputs: { results: [], source: 'duckduckgo' } }
    }

    return {
      success: true,
      outputs: {
        results: collectResults.slice(0, limit),
        source: 'duckduckgo',
      },
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to parse search results: ${(error as Error).message}`,
    }
  }
}
