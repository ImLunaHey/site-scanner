import '@total-typescript/ts-reset';
import { resolve4, resolve6 } from 'node:dns';
import React, { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Axiom } from '@axiomhq/js';
import { Simplify } from 'type-fest';
import { version } from '../package.json' assert { type: 'json' };
import { isIPv4, isIPv6 } from 'node:net';

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
    body {
        background: var(--primary-colour);
        color: var(--text-colour);
        font-family: monospace;
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
    form {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        height: 300px;
    }
    .form-group {
        width: 75%;
        display: flex;
        flex-flow: row;
    }
    input {
        margin-bottom: 20px;
    }
    button {
        height: 50px;
    }
    input[type=checkbox] {
        width: 10%;
        height: 20px;
    }
    label {
        width: 90%;
        font-size: 20px;
    }
    input, button {
        padding: 5px;
        width: 75%;
        font-size: 20px;
        font-family: monospace;
    }
`;
const Styles: React.FC = () => <style>{style}</style>;

const HomePage: React.FC = () => {
    return (
        <>
            <title>Site Scanner</title>
            <Styles />
            <form method='GET' action='/'>
                <input name="q" placeholder='https://google.com' required />
                <div className="form-group">
                    <input id="force" type="checkbox" name="force" value="true" />
                    <label htmlFor="force">Force reload?</label>
                </div>
                <button type="submit">Submit</button>
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

type ResultsEvent = Simplify<Event & {
    eventType: 'result';
    checks: any;
}>;

const ResultsPanel: React.FC<{
    results: ResultsEvent;
}> = ({ results }) => {
    return <>
        <title>Site Scanner</title>
        <Styles />
        <pre>{JSON.stringify(results, null, 2)}</pre>
    </>;
};

const createResponse = (element: ReactElement) => {
    return new Response(renderToStaticMarkup(element), {
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
const doChecks = async (query: string) => {
    const { hostname } = new URL(query);
    const response = await fetch(query, options);
    const rawHeaders = Object.fromEntries(response.headers.entries());
    const ips = [await resolveIp(hostname, '4'), await resolveIp(hostname, '6')].flat().filter(Boolean);
    const ipAddress = {
        ipv4: ips.filter(ip => isIPv4(ip)),
        ipv6: ips.filter(ip => isIPv6(ip)),
    };
    return {
        rawHeaders,
        ipAddress,
    };
};

const Error: React.FC<{ message: string }> = ({ message }) => {
    return <>
        <title>Site Scanner</title>
        <Styles />
        <div>Error: {message}</div>
    </>;
};

const fetchNewResults = async (query: string) => {
    const { hostname } = new URL(query);
    const resultsEvent = {
        eventType: 'result',
        query,
        hostname,
        checks: await doChecks(query),
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
    const result = await axiom.query(`['site-scanner'] | where eventType == "result" | where hostname == "${hostname}" | sort by _time desc | limit 1`);
    const match = result.matches?.[0];
    if (!match) return;
    return {
        _time: match?._time,
        data: removeEmpty(match?.data as ResultsEvent),
    };
};

const ips = new Set<string>();

Bun.serve({
    async fetch(request, server) {
        try {
            const url = new URL(request.url);
            const query = url.searchParams.get('q')?.toLowerCase();

            // Show the Homepage is we don't have a query
            if (!query) return createResponse(<HomePage />);

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
                if (limited) return createResponse(<Error message={`Rate limited by "${ipAddress}"`} />);
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
            return createResponse(<Error message={(error as Error).message} />);
        }
    },
});
