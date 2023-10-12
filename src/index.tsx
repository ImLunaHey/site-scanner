import { resolve4, resolve6 } from 'node:dns';
import React, { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Axiom } from '@axiomhq/js';
import { Simplify } from 'type-fest';

const ONE_MINUTE = 60 * 1_000;
const ONE_HOUR = 60 * ONE_MINUTE;
const ONE_DAY = 24 * ONE_HOUR;
const TWO_WEEKS = 14 * ONE_DAY;

const axiom = new Axiom({
    token: process.env.AXIOM_TOKEN!,
    orgId: process.env.AXIOM_ORG_ID!,
});

const HomePage: React.FC = () => {
    return (
        <form method='GET' action='/'>
            <input name="q" placeholder='https://google.com'></input>
            <button type="submit">Submit</button>
        </form>
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

const CheckSite: React.FC<{
    results: ResultsEvent;
}> = ({ results }) => {
    return <pre>{JSON.stringify(results, null, 2)}</pre>;
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

const checkHeaders = async (query: string) => {
    const { hostname } = new URL(query);
    const response = await fetch(query);
    const rawHeaders = Object.fromEntries(response.headers.entries());
    const ipAddress = {
        ipv4: await resolveIp(hostname, '4'),
        // ipv6: await resolveIp(hostname, '6'),
    };
    return {
        rawHeaders,
        ipAddress,
    };
};

const Error: React.FC<{ message: string }> = ({ message }) => {
    return <div>Error: {message}</div>;
};

const fetchNewResults = async (query: string) => {
    const { hostname } = new URL(query);
    const resultsEvent = {
        eventType: 'result',
        query,
        hostname,
        checks: {
            headers: await checkHeaders(query),
        },
    } satisfies ResultsEvent;

    axiom.ingest(process.env.AXIOM_DATASET!, [resultsEvent]);
    await axiom.flush();
    return {
        _time: new Date().toISOString(),
        data: resultsEvent,
    };
};

const fetchLastResultsMatch = async (query: string) => {
    const { hostname } = new URL(query);
    const result = await axiom.query(`['site-scanner'] | where eventType == "result" | where hostname == "${hostname}" | sort by _time desc | limit 1`);
    const match = result.matches?.[0];
    if (!match) return;
    return {
        _time: match?._time,
        data: match?.data as ResultsEvent,
    };
};

Bun.serve({
    async fetch(request) {
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
            const force = url.searchParams.get('force');

            // Either fetch new or existing results
            const resultsMatch = force ? await fetchNewResults(query) : await fetchLastResultsMatch(query);

            // If the results we got back we're over 2 weeks old generate new ones
            const isOutOfDate = resultsMatch ? (new Date(resultsMatch._time!).getTime()) <= (Date.now() - TWO_WEEKS) : true;
            const results = isOutOfDate ? await fetchNewResults(query).then(results => results.data) : resultsMatch!.data;

            // Return results
            return createResponse(<CheckSite results={results} />);
        } catch (error: unknown) {
            return createResponse(<Error message={(error as Error).message} />);
        }
    },
});
