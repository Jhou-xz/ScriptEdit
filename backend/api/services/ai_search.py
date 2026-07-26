import json
import os
import re
import urllib.parse
import urllib.request
from typing import Dict, List


def safe_urlopen(req: urllib.request.Request, timeout: int = 10):
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.URLError as e:
        if isinstance(e.reason, OSError) and getattr(e.reason, "errno", None) == 61:
            old_no_proxy = os.environ.get("no_proxy")
            os.environ["no_proxy"] = "*"
            try:
                clean_req = urllib.request.Request(req.full_url, data=req.data, headers=req.headers, method=req.get_method())
                return urllib.request.urlopen(clean_req, timeout=timeout)
            finally:
                if old_no_proxy is None:
                    os.environ.pop("no_proxy", None)
                else:
                    os.environ["no_proxy"] = old_no_proxy
        raise e


def perform_web_search(query: str, max_results: int = 4) -> List[Dict[str, str]]:
    """
    Executes a web search for documentary fact-checking, historical details, or B-roll video search.
    Supports Tavily API, DDGS, or DuckDuckGo HTML fallback out of the box.
    """
    results: List[Dict[str, str]] = []

    # 1. Check Tavily API if configured
    tavily_key = os.environ.get("TAVILY_API_KEY")
    if tavily_key:
        try:
            req = urllib.request.Request(
                "https://api.tavily.com/search",
                data=json.dumps({
                    "api_key": tavily_key,
                    "query": query,
                    "max_results": max_results,
                    "include_answer": False,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with safe_urlopen(req, timeout=10) as res:
                data = json.loads(res.read().decode("utf-8"))
                for item in data.get("results", [])[:max_results]:
                    results.append({
                        "title": item.get("title", ""),
                        "snippet": item.get("content", ""),
                        "url": item.get("url", ""),
                    })
                if results:
                    return results
        except Exception:
            pass

    # 2. Fallback to DuckDuckGo HTML search
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        req = urllib.request.Request(url, headers=headers, method="GET")
        with safe_urlopen(req, timeout=8) as res:
            html = res.read().decode("utf-8", errors="ignore")
            raw_results = re.findall(r'<a class="result__a" href="([^"]+)">(.*?)</a>.*?<a class="result__snippet[^"]*">(.*?)</a>', html, re.DOTALL)
            for raw_url, raw_title, raw_snippet in raw_results[:max_results]:
                clean_title = re.sub(r'<[^>]+>', '', raw_title).strip()
                clean_snippet = re.sub(r'<[^>]+>', '', raw_snippet).strip()
                clean_url = raw_url
                if "uddg=" in clean_url:
                    m = re.search(r'uddg=([^&]+)', clean_url)
                    if m:
                        clean_url = urllib.parse.unquote(m.group(1))
                if clean_title and clean_url:
                    results.append({
                        "title": clean_title,
                        "snippet": clean_snippet,
                        "url": clean_url,
                    })
            if results:
                return results
    except Exception:
        pass

    # 3. Fallback to DDGS library
    try:
        from ddgs import DDGS
        ddg_results = DDGS().text(query, max_results=max_results)
        for r in ddg_results:
            results.append({
                "title": r.get("title", ""),
                "snippet": r.get("body", ""),
                "url": r.get("href", ""),
            })
    except Exception:
        pass

    return results
