import '@total-typescript/ts-reset';
import { resolve4, resolve6 } from 'node:dns';
import React, { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Axiom } from '@axiomhq/js';
import { Simplify } from 'type-fest';
import { version } from '../package.json' assert { type: 'json' };
import { isIPv4, isIPv6 } from 'node:net';
import outdent from 'outdent';
import { headerSchema } from './validation';
import { minify } from 'html-minifier';

const ONE_MINUTE = 60 * 1_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const TWO_WEEKS = 14 * ONE_DAY;

const axiom = new Axiom({
    token: process.env.AXIOM_TOKEN!,
    orgId: process.env.AXIOM_ORG_ID!,
});

const style = `
    :root {
        --primary-colour:#101010;
        --secondary-colour:#1d1d1d;
        --text-colour: #e2e2e2;
    }
    * {
        font-family: monospace;
    }
    body {
        background: var(--primary-colour);
        color: var(--text-colour);
    }
    pre {
        background-color: var(--secondary-colour);
        color: var(--text-colour);
        border: 1px solid silver;
        padding: 10px 20px;
        margin: 20px auto;
        border-radius: 4px;
        width: 75%;
        overflow: scroll;
    }
    body {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
    }
    .form-group {
        display: flex;
        flex-flow: row;
    }
    input {
        margin-bottom: 20px;
    }
    input[type=checkbox] {
        width: 10%;
    }
    input, button {
        padding: 5px;
    }
    input {
        width: 100%;
    }
    form {
        width: 50%;
        display: inline-grid;
        margin-top: 250px;
    }
    footer {
        text-align: center;
        width: 100%;
    }
`;
const Styles: React.FC = () => <style>{style}</style>;

const HomePage: React.FC<{ scans?: number; queries?: number; }> = ({ scans = 0, queries = 0 }) => {
    return (
        <>
            <title>Site Scanner</title>
            <Styles />
            <form method='GET' action='/'>
                <div className='form-group'>
                    <input name='q' placeholder='https://google.com' required />
                    <input id='force' type='checkbox' name='force' value='true' />
                    <label htmlFor='force'>Force reload?</label>
                </div>
                <button type='submit'>Submit</button>
            </form>
        </>
    );
};

type Event = {
    eventType: string;
    query: string;
    hostname: string;
}

type QueryEvent = Simplify<Event & {
    eventType: 'query';
}>;

const calculateSecurityGrade = (headers: Record<string, unknown>) => {
    // Validate the headers against the schema
    const parsedHeaders = headerSchema.safeParse(headers);

    // If validation succeeds with no issues, assign A
    if (parsedHeaders.success) return 'A';

    // Calculate grade based on the number of issues
    const numIssues = parsedHeaders.error.issues.length;

    // Assign grades based on severity thresholds
    if (numIssues <= 2) return 'B';
    if (numIssues <= 4) return 'C';
    if (numIssues <= 6) return 'D';

    // Default to F for many severe issues
    return 'F';
};

type ResultsEvent = Simplify<Event & {
    eventType: 'result';
    rawHeaders: {
        [k: string]: string;
    };
    ipAddress: {
        ipv4: string[];
        ipv6: string[];
    };
    checks: {
        headers: {
            [k: string]: string;
        }
    }
    info: {
        providers: {
            cloudflare: boolean;
            railway: boolean;
            vercel: boolean;
        }
    }
    grade: 'A' | 'B' | 'C' | 'D' | 'F';
}>;

const ResultsPanel: React.FC<{
    results: ResultsEvent;
}> = ({ results }) => {
    return <>
        <title>Site Scanner</title>
        <Styles />

        <h1>Info</h1>
        <pre>{JSON.stringify(results.info, null, 2)}</pre>

        <h1>Checks</h1>
        <pre>{JSON.stringify(results.checks, null, 2)}</pre>
        
        <h1>Raw Headers</h1>
        <pre>{JSON.stringify(results.rawHeaders, null, 2)}</pre>

        <footer><span title={footerDescription}>Hostname: {results.hostname}</span> | Grade: {results.grade}</footer>
    </>;
};

const footerDescription = outdent`
A 'scan' is activated when you make a request on our platform. This typically occurs if the data exceeds a 2-week threshold or if you choose to 'force reload' by checking the corresponding checkbox.
A 'query' covers a broader scope, encompassing all scans and instances where we display results even if a new scan was not run.
`;

const createResponse = async (element: ReactElement) => {
    // Fetch stats
    const queries = await axiom.query(`['site-scanner'] | where eventType == 'query' | count | project count=Count`).then(result => result.matches?.[0].data.count ?? 0).catch(() => 0);
    const scans = await axiom.query(`['site-scanner'] | where eventType == 'result' | count | project count=Count`).then(result => result.matches?.[0].data.count ?? 0).catch(() => 0);
    return new Response(minify('<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="description" content="Site Scanner"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' + renderToStaticMarkup(<>
        {element}
        <footer><span title={footerDescription}>Scans: {scans}</span> | Queries: {queries}</footer>
    </>) + '</html>', {
        removeComments: true,
        removeRedundantAttributes: true,
        useShortDoctype: true,
        collapseWhitespace: true,
        minifyCSS: true,
    }), {
        headers: {
            'content-type': 'text/html',
        }
    });
};

const resolveIp = (hostname: string, version: '4' | '6') => {
    if (version === '4') return new Promise<string[]>((resolve, reject) => {
        resolve4(hostname, (error, addresses) => {
            if (error) return reject(error);
            resolve(addresses);
        });
    });

    if (version === '6') return new Promise<string[]>((resolve, reject) => {
        resolve6(hostname, (error, addresses) => {
            if (error) return reject(error);
            resolve(addresses);
        });
    });
};

const options = {
    headers: {
        'user-agent': `site-scanner@${version}`
    },
};
const doChecks = async (rawHeaders: Record<string, string>) => {
    const parsedHeaders = headerSchema.safeParse(rawHeaders);
    const headers = parsedHeaders.success ? Object.fromEntries(Object.keys(parsedHeaders.data).map(key => [key, 'Pass'])) : Object.fromEntries(parsedHeaders.error.errors.map(error => [error.path[0], error.message]));
    return {
        headers,
    };
};

const Failure: React.FC<{ message: string }> = ({ message }) => {
    return <>
        <title>Site Scanner</title>
        <Styles />
        <div>Error: {message}</div>
    </>;
};

const fetchNewResults = async (query: string) => {
    const { hostname } = new URL(query);
    const response = await fetch(query, options);
    const rawHeaders = Object.fromEntries(response.headers.entries());
    const ips = [await resolveIp(hostname, '4'), await resolveIp(hostname, '6')].flat().filter(Boolean);
    const ipAddress = {
        ipv4: ips.filter(ip => isIPv4(ip)),
        ipv6: ips.filter(ip => isIPv6(ip)),
    };
    const resultsEvent = {
        eventType: 'result',
        query,
        hostname,
        rawHeaders,
        ipAddress,
        checks: await doChecks(rawHeaders),
        info: {
            providers: {
                cloudflare: !!Object.keys(rawHeaders).find(header => header.startsWith('cf-'))?.length,
                railway: rawHeaders.server === 'railway',
                vercel: !!Object.keys(rawHeaders).find(header => header.startsWith('x-vercel-'))?.length || rawHeaders.server === 'Vercel',
            }
        },
        grade: calculateSecurityGrade(rawHeaders),
    } satisfies ResultsEvent;

    axiom.ingest(process.env.AXIOM_DATASET!, [resultsEvent]);
    await axiom.flush();
    return {
        _time: new Date().toISOString(),
        data: resultsEvent,
    };
};

function removeEmpty<T>(obj: T): T {
    return Object.fromEntries(
        Object.entries(obj as any)
            .filter(([_, v]) => v != null)
            .map(([k, v]) => [k, (typeof v === 'object' && !Array.isArray(v)) ? removeEmpty(v) : v])
    ) as T;
};

const fetchLastResultsMatch = async (query: string) => {
    const { hostname } = new URL(query);
    const result = await axiom.query(`['site-scanner'] | where eventType == 'result' | where hostname == '${hostname}' | sort by _time desc | limit 1`);
    const match = result.matches?.[0];
    if (!match) return;
    return {
        _time: match?._time,
        data: removeEmpty(match?.data as ResultsEvent),
    };
};

const ips = new Set<string>();

Bun.serve({
    port: process.env.PORT ?? 3000,
    async fetch(request, server) {
        try {
            const url = new URL(request.url);
            const query = url.searchParams.get('q')?.toLowerCase();

            // Allow all traffic to view the whole site
            if (url.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /');

            // Show the Homepage is we don't have a query
            if (!query) return createResponse(<HomePage />);

            // Check if the query is valid first
            const hasCorrectSchema = query.startsWith('http://') || query.startsWith('https://');
            if (!hasCorrectSchema) throw new Error('The URL must begin with http:// or https://');
            const hasTld = query.split('.')?.[1]?.length >= 2;
            if (!hasTld) throw new Error('The URL must end with a TLD');

            // Record this query
            const queryEvent = {
                eventType: 'query',
                query,
                hostname: new URL(query).hostname,
            } satisfies QueryEvent;
            axiom.ingest(process.env.AXIOM_DATASET!, queryEvent);
            await axiom.flush();

            // Do we actually need to recheck?
            const force = !!url.searchParams.get('force');

            // Either fetch new or existing results
            const resultsMatch = force ? await fetchNewResults(query) : await fetchLastResultsMatch(query);

            // If the results we got back we're over 2 weeks old generate new ones
            const isOutOfDate = force || (resultsMatch ? (new Date(resultsMatch._time!).getTime()) <= (Date.now() - TWO_WEEKS) : true);

            // Get client's IP
            const ipAddress = request.headers.get('X-Forwarded-For')?.split(',')?.[0] ?? server.requestIP(request)?.address ?? 'unknown';

            // Check if they're currently limited
            const limited = ips.has(ipAddress);

            // Basic rate limiting
            // Allow one actual request per 10s
            // Users can do unlimited cached queries
            if (isOutOfDate) {
                if (limited) return createResponse(<Failure message={`Rate limited by '${ipAddress}'`} />);
                console.info(JSON.stringify({ message: 'Rate limiting', meta: { ipAddress } }, null, 0));
                ips.add(ipAddress);
                setTimeout(() => {
                    ips.delete(ipAddress);
                }, 10_000);
            }

            // Get most up to date results
            const results = isOutOfDate ? await fetchNewResults(query).then(results => results.data) : resultsMatch!.data;

            // Return results
            return createResponse(<ResultsPanel results={results} />);
        } catch (error: unknown) {
            return createResponse(<Failure message={(error as Error).message} />);
        }
    },
});
