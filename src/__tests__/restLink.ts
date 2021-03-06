import { execute, makePromise, ApolloLink } from 'apollo-link';
import { ApolloClient } from 'apollo-client';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { onError } from 'apollo-link-error';

import gql, { disableFragmentWarnings } from 'graphql-tag';
disableFragmentWarnings();

import * as camelCase from 'camelcase';
const snake_case = require('snake-case');
import * as fetchMock from 'fetch-mock';

import {
  RestLink,
  validateRequestMethodForOperationType,
  normalizeHeaders,
} from '../restLink';

const sampleQuery = gql`
  query post {
    post(id: "1") @rest(type: "Post", path: "/post/:id") {
      id
    }
  }
`;

type Result = { [index: string]: any };

describe('Configuration', async () => {
  describe('Errors', async () => {
    afterEach(() => {
      fetchMock.restore();
    });

    it('throws without any config', () => {
      expect.assertions(3);

      expect(() => {
        new RestLink(undefined);
      }).toThrow();
      expect(() => {
        new RestLink({} as any);
      }).toThrow();
      expect(() => {
        new RestLink({ bogus: '' } as any);
      }).toThrow();
    });

    it('throws with mismatched config', () => {
      expect.assertions(1);
      expect(() => {
        new RestLink({ uri: '/correct', endpoints: { '': '/mismatched' } });
      }).toThrow();
    });

    it('throws if missing both path and pathBuilder', async () => {
      expect.assertions(1);

      const link = new RestLink({ uri: '/api' });
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post @rest(type: "Post") {
            id
            title
          }
        }
      `;

      try {
        await makePromise<Result>(
          execute(link, {
            operationName: 'postTitle',
            query: postTitleQuery,
          }),
        );
      } catch (error) {
        expect(error.message).toBe(
          `One and only one of ("path" | "pathBuilder") must be set in the @rest() directive. ` +
            `This request had neither, please add one!`,
        );
      }
    });

    it('throws if both path and pathBuilder are simultaneously provided', async () => {
      expect.assertions(1);

      const link = new RestLink({ uri: '/api' });
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle($pathBuilder: any) {
          post @rest(type: "Post", path: "/post/1", pathBuilder: $pathBuilder) {
            id
            title
          }
        }
      `;

      try {
        await makePromise<Result>(
          execute(link, {
            operationName: 'postTitle',
            query: postTitleQuery,
            variables: {
              pathBuilder: (args: any) => '/whatever',
            },
          }),
        );
      } catch (error) {
        expect(error.message).toBe(
          `One and only one of ("path" | "pathBuilder") must be set in the @rest() directive. ` +
            `This request had both, please remove one!`,
        );
      }
    });

    it('throws when invalid typePatchers', async () => {
      expect.assertions(4);
      // If using typescript, the typescript compiler protects us against allowing this.
      // but if people use javascript or force it, we want exceptions to be thrown.
      const pretendItsJavascript = (arg: any): any => arg;

      expect(() => {
        new RestLink({
          uri: '/correct',
          typePatcher: pretendItsJavascript(-1),
        });
      }).toThrow();
      expect(() => {
        new RestLink({
          uri: '/correct',
          typePatcher: pretendItsJavascript('fail'),
        });
      }).toThrow();
      expect(() => {
        new RestLink({
          uri: '/correct',
          typePatcher: pretendItsJavascript([]),
        });
      }).toThrow();
      expect(() => {
        new RestLink({
          uri: '/correct',
          typePatcher: pretendItsJavascript({
            key: 'my values are not functions',
          }),
        });
      }).toThrow();
    });

    it("Doesn't throw on good configs", () => {
      expect.assertions(1);

      new RestLink({ uri: '/correct' });
      new RestLink({ uri: '/correct', endpoints: { other: '/other' } });
      new RestLink({
        uri: '/correct',
        endpoints: { '': '/correct', other: '/other' },
      });
      new RestLink({ endpoints: { '': '/correct', other: '/other' } });

      expect(true).toBe(true);
    });
  });

  describe('Field name normalizer', async () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('should apply fieldNameNormalizer if specified', async () => {
      expect.assertions(3);
      const link = new RestLink({
        uri: '/api',
        fieldNameNormalizer: camelCase,
      });
      // "Server" returns TitleCased and snake_cased fields
      // fieldNameNormalizer changes them to camelCase
      const post = { id: '1', Title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const tags = [
        { Name: 'apollo', tag_description: 'once' },
        { Name: 'graphql', tag_description: 'twice' },
      ];
      fetchMock.get('/api/tags', tags);

      const postAndTags = gql`
        query postAndTags {
          post @rest(type: "Post", path: "/post/1") {
            id
            title
            tags @rest(type: "[Tag]", path: "/tags") {
              name
              tagDescription
            }
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postAndTags,
        }),
      );

      expect(data.post.title).toBeDefined();
      expect(data.post.tags[0].name).toBeDefined();
      expect(data.post.tags[0].tagDescription).toEqual('once');
    });
    it('should preserve __typename when using fieldNameNormalizer', async () => {
      expect.assertions(2);
      const link = new RestLink({
        uri: '/api',
        fieldNameNormalizer: camelCase,
      });
      const post = { id: '1', Title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const tags = [{ Name: 'apollo' }, { Name: 'graphql' }];
      fetchMock.get('/api/tags', tags);

      const postAndTags = gql`
        query postAndTags {
          post @rest(type: "Post", path: "/post/1") {
            __typename
            id
            title
            tags @rest(type: "[Tag]", path: "/tags") {
              name
            }
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postAndTags,
        }),
      );

      expect(data.post.__typename).toBeDefined();
      expect(data.post.__typename).toEqual('Post');
    });
  });

  describe('Custom fetch', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('should apply customFetch if specified', async () => {
      expect.assertions(1);

      const link = new RestLink({
        uri: '/api',
        customFetch: (uri, options) =>
          new Promise((resolve, reject) => {
            const body = JSON.stringify({ title: 'custom' });
            resolve(new Response(body));
          }),
      });

      const postTitle = gql`
        query postTitle {
          post @rest(type: "Post", path: "/post/1") {
            title
          }
        }
      `;

      const { data } = await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitle,
        }),
      );

      expect(data.post.title).toBe('custom');
    });
  });
});
describe('Complex responses need nested __typename insertions', () => {
  it('can configure typename by providing a custom type-patcher table', async () => {
    expect.assertions(1);

    const patchIfExists = (
      data: any,
      key: string,
      __typename: string,
      patcher: RestLink.FunctionalTypePatcher,
    ) => {
      const value = data[key];
      if (value == null) {
        return {};
      }
      const result = { [key]: patcher(value, __typename, patcher) };
      return result;
    };
    const typePatcher: RestLink.TypePatcherTable = {
      Outer: (
        obj: any,
        outerType: string,
        patchDeeper: RestLink.FunctionalTypePatcher,
      ) => {
        if (obj == null) {
          return obj;
        }

        return {
          ...obj,
          ...patchIfExists(obj, 'inner1', 'Inner1', patchDeeper),
          ...patchIfExists(
            obj,
            'simpleDoubleNesting',
            'SimpleDoubleNesting',
            patchDeeper,
          ),
          ...patchIfExists(obj, 'nestedArrays', 'NestedArrays', patchDeeper),
        };
      },
      Inner1: (
        obj: any,
        outerType: string,
        patchDeeper: RestLink.FunctionalTypePatcher,
      ) => {
        if (obj == null) {
          return obj;
        }
        return {
          ...obj,
          ...patchIfExists(obj, 'reused', 'Reused', patchDeeper),
        };
      },
      SimpleDoubleNesting: (
        obj: any,
        outerType: string,
        patchDeeper: RestLink.FunctionalTypePatcher,
      ) => {
        if (obj == null) {
          return obj;
        }

        return {
          ...obj,
          ...patchIfExists(obj, 'inner1', 'Inner1', patchDeeper),
        };
      },
      NestedArrays: (
        obj: any,
        outerType: string,
        patchDeeper: RestLink.FunctionalTypePatcher,
      ) => {
        if (obj == null) {
          return obj;
        }

        return {
          ...obj,
          ...patchIfExists(
            obj,
            'singlyArray',
            'SinglyNestedArrayEntry',
            patchDeeper,
          ),
          ...patchIfExists(
            obj,
            'doublyNestedArray',
            'DoublyNestedArrayEntry',
            patchDeeper,
          ),
        };
      },
    };

    const link = new RestLink({ uri: '/api', typePatcher });
    const root = {
      id: '1',
      inner1: { data: 'outer.inner1', reused: { id: 1 } },
      simpleDoubleNesting: {
        data: 'dd',
        inner1: { data: 'outer.SDN.inner1', reused: { id: 2 } },
      },
      nestedArrays: {
        unrelatedArray: ['string', 10],
        singlyArray: [{ data: 'entry!' }],
        doublyNestedArray: [[{ data: 'inception.entry!' }]],
      },
    };
    const rootTyped = {
      __typename: 'Outer',
      id: '1',
      inner1: {
        __typename: 'Inner1',
        data: 'outer.inner1',
        reused: { __typename: 'Reused', id: 1 },
      },
      simpleDoubleNesting: {
        __typename: 'SimpleDoubleNesting',
        data: 'dd',
        inner1: {
          __typename: 'Inner1',
          data: 'outer.SDN.inner1',
          reused: { __typename: 'Reused', id: 2 },
        },
      },
      nestedArrays: {
        __typename: 'NestedArrays',
        unrelatedArray: ['string', 10],
        singlyArray: [{ __typename: 'SinglyNestedArrayEntry', data: 'entry!' }],
        doublyNestedArray: [
          [
            {
              __typename: 'DoublyNestedArrayEntry',
              data: 'inception.entry!',
            },
          ],
        ],
      },
    };

    fetchMock.get('/api/outer/1', root);

    const someQuery = gql`
      query someQuery {
        outer @rest(type: "Outer", path: "/outer/1") {
          id
          inner1 {
            data
            reused {
              id
            }
          }
          simpleDoubleNesting {
            data
            inner1 {
              data
              reused {
                id
              }
            }
          }
          nestedArrays {
            unrelatedArray
            singlyArray {
              data
            }
            doublyNestedArray {
              data
            }
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'someOperation',
        query: someQuery,
      }),
    );

    expect(data).toMatchObject({
      outer: rootTyped,
    });
  });
});

describe('Query single call', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can run a simple query', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });
    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({ post: { ...post, __typename: 'Post' } });
  });

  it('can get query params regardless of the order', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });
    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @rest(path: "/post/1", type: "Post") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({ post });
  });

  it('can return array result with typename', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const tags = [{ name: 'apollo' }, { name: 'graphql' }];
    fetchMock.get('/api/tags', tags);

    // Verify multidimensional array support: https://github.com/apollographql/apollo-client/issues/776
    const keywordGroups = [
      [{ name: 'group1.element1' }, { name: 'group1.element2' }],
      [
        { name: 'group2.element1' },
        { name: 'group2.element2' },
        { name: 'group2.element3' },
      ],
    ];
    fetchMock.get('/api/keywordGroups', keywordGroups);

    const tagsQuery = gql`
      query tags {
        tags @rest(type: "[Tag]", path: "/tags") {
          name
        }
        keywordGroups @rest(type: "[ [ Keyword ] ]", path: "/keywordGroups") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'tags',
        query: tagsQuery,
      }),
    );

    const tagsWithTypeName = tags.map(tag => ({
      ...tag,
      __typename: 'Tag',
    }));
    const keywordGroupsWithTypeName = keywordGroups.map(kg =>
      kg.map(element => ({ ...element, __typename: 'Keyword' })),
    );
    expect(data).toMatchObject({
      tags: tagsWithTypeName,
      keywordGroups: keywordGroupsWithTypeName,
    });
  });

  it('can filter the query result', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = {
      id: '1',
      title: 'Love apollo',
      content: 'Best graphql client ever.',
    };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postWithContent',
        query: postTitleQuery,
      }),
    );

    expect(data.post.content).toBeUndefined();
  });

  it('can pass param to a query without a variable', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });
    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({ post: { ...post, __typename: 'Post' } });
  });

  it('can pass param to a query with a variable', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const postTitleQuery = gql`
      query postTitle {
        post(id: $id) @rest(type: "Post", path: "/post/:id") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
        variables: { id: '1' },
      }),
    );

    expect(data.post.title).toBe(post.title);
  });

  it('can pass param with `0` value to a query with a variable', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/feed?offset=0', post);

    const feedQuery = gql`
      query feed {
        post(offset: $offset)
          @rest(type: "Post", path: "/feed?offset=:offset") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'feed',
        query: feedQuery,
        variables: { offset: 0 },
      }),
    );

    expect(data.post.title).toBe(post.title);
  });

  it('can pass param with `false` value to a query with a variable', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/feed?published=false', post);

    const feedQuery = gql`
      query feed {
        post(published: $published)
          @rest(type: "Post", path: "/feed?published=:published") {
          id
          title
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'feed',
        query: feedQuery,
        variables: { published: false },
      }),
    );

    expect(data.post.title).toBe(post.title);
  });

  it('can pass param with `null` value to a query with a variable', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const person = { name: 'John' };
    fetchMock.get('/api/people?address=null', person);

    const peopleWithoutAddressQuery = gql`
      query feed {
        people(address: $address)
          @rest(type: "Person", path: "/people?address=:address") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'feed',
        query: peopleWithoutAddressQuery,
        variables: { address: null },
      }),
    );

    expect(data.people.name).toBe(person.name);
  });

  it('can hit two endpoints!', async () => {
    expect.assertions(2);

    const link = new RestLink({ endpoints: { v1: '/v1', v2: '/v2' } });

    const postV1 = { id: '1', title: '1. Love apollo' };
    const postV2 = { id: '1', titleText: '2. Love apollo' };
    fetchMock.get('/v1/post/1', postV1);
    fetchMock.get('/v2/post/1', postV2);

    const postTitleQuery1 = gql`
      query postTitle($id: ID!) {
        post(id: $id) @rest(type: "Post", path: "/post/:id", endpoint: "v1") {
          id
          title
        }
      }
    `;
    const postTitleQuery2 = gql`
      query postTitle($id: ID!) {
        post(id: $id) @rest(type: "Post", path: "/post/:id", endpoint: "v2") {
          id
          titleText
        }
      }
    `;

    const { data: data1 } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle1',
        query: postTitleQuery1,
        variables: { id: '1' },
      }),
    );
    const { data: data2 } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle2',
        query: postTitleQuery2,
        variables: { id: '1' },
      }),
    );

    expect(data1.post.title).toBe(postV1.title);
    expect(data2.post.titleText).toBe(postV2.titleText);
  });

  it('can make a doubly nested query!', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });
    const post = {
      id: '1',
      title: 'Love apollo',
      nested: { data: 'test', secondNestKey: 'proof' },
    };
    const postWithNest = { ...post };
    (postWithNest.nested as any).test = {
      __typename: 'Inner',
      positive: 'winning',
    };

    fetchMock.get('/api/post/1', post);
    fetchMock.get('/api/post/proof', { positive: 'winning' });

    const postTitleQuery = gql`
      query postTitle {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
          nested {
            data
            secondNestKey @export(as: innerNest)
            test @rest(type: "Inner", path: "/post/:innerNest") {
              positive
            }
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
      }),
    );

    expect(data).toMatchObject({
      post: { ...postWithNest, __typename: 'Post' },
    });
  });

  it('can build the path using pathBuilder', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });
    const posts = [{ id: '1', title: 'Love apollo' }];
    fetchMock.get('/api/posts?status=published', posts);

    const postTitleQuery = gql`
      query postTitle($pathFunction: any, $status: String) {
        posts(status: $status) @rest(type: "Post", pathBuilder: $pathFunction) {
          id
          title
        }
      }
    `;

    function createPostsPath(variables) {
      const qs = Object.keys(
        variables,
      ).reduce((acc: string, key: string): string => {
        if (variables[key] === null || variables[key] === undefined) {
          return acc;
        }
        if (acc === '') {
          return '?' + key + '=' + encodeURIComponent(String(variables[key]));
        }
        return (
          acc + '&' + key + '=' + encodeURIComponent(String(variables[key]))
        );
      }, '');
      return '/posts' + qs;
    }

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQuery,
        variables: {
          status: 'published',
          pathFunction: createPostsPath,
        },
      }),
    );

    expect(data).toMatchObject({
      posts: [{ ...posts[0], __typename: 'Post' }],
    });
  });
});

describe('Query multiple calls', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can run a query with multiple rest calls', async () => {
    expect.assertions(2);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const tags = [{ name: 'apollo' }, { name: 'graphql' }];
    fetchMock.get('/api/tags', tags);

    const postAndTags = gql`
      query postAndTags {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
        }
        tags @rest(type: "[Tag]", path: "/tags") {
          name
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postAndTags',
        query: postAndTags,
      }),
    );

    expect(data.post).toBeDefined();
    expect(data.tags).toBeDefined();
  });

  it('can run a subquery with multiple rest calls', async () => {
    expect.assertions(2);
    ``;

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const tags = [{ name: 'apollo' }, { name: 'graphql' }];
    fetchMock.get('/api/tags', tags);

    const postAndTags = gql`
      query postAndTags {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
          tags @rest(type: "[Tag]", path: "/tags") {
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postAndTags',
        query: postAndTags,
      }),
    );

    expect(data.post).toBeDefined();
    expect(data.post.tags).toBeDefined();
  });

  +it('GraphQL aliases should work', async () => {
    expect.assertions(2);

    const link = new RestLink({ endpoints: { v1: '/v1', v2: '/v2' } });

    const postV1 = { id: '1', title: '1. Love apollo' };
    const postV2 = { id: '1', titleText: '2. Love apollo' };
    fetchMock.get('/v1/post/1', postV1);
    fetchMock.get('/v2/post/1', postV2);

    const postTitleQueries = gql`
      query postTitle($id: ID!) {
        v1: post(id: $id)
          @rest(type: "Post", path: "/post/:id", endpoint: "v1") {
          id
          title
        }
        v2: post(id: $id)
          @rest(type: "Post", path: "/post/:id", endpoint: "v2") {
          id
          titleText
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTitleQueries,
        variables: { id: '1' },
      }),
    );

    expect(data.v1.title).toBe(postV1.title);
    expect(data.v2.titleText).toBe(postV2.titleText);
  });
});

describe('Query options', () => {
  afterEach(() => {
    fetchMock.restore();
  });
  describe('credentials', () => {
    it('adds credentials to the request from the setup', async () => {
      expect.assertions(1);
      const link = new RestLink({
        uri: '/api',
        // Casting to RequestCredentials for testing purposes,
        // the only valid values here defined by RequestCredentials from Fetch
        // and typescript will yell at you for violating this!
        credentials: 'my-credentials' as RequestCredentials,
      });

      const post = { id: '1', Title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });

    it('adds credentials to the request from the context', async () => {
      expect.assertions(2);

      const credentialsMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          credentials: 'my-credentials',
        });
        return forward(operation).map(result => {
          const { credentials } = operation.getContext();
          expect(credentials).toBeDefined();
          return result;
        });
      });

      const link = ApolloLink.from([
        credentialsMiddleware,
        new RestLink({ uri: '/api' }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });

    it('prioritizes context credentials over setup credentials', async () => {
      expect.assertions(2);

      const credentialsMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          credentials: 'my-credentials',
        });
        return forward(operation).map(result => {
          const { credentials } = operation.getContext();
          expect(credentials).toBeDefined();
          return result;
        });
      });

      const link = ApolloLink.from([
        credentialsMiddleware,
        new RestLink({
          uri: '/api',
          credentials: 'wrong-credentials' as RequestCredentials,
        }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      await makePromise<Result>(
        execute(link, {
          operationName: 'post',
          query: sampleQuery,
        }),
      );

      const credentials = fetchMock.lastCall()[1].credentials;
      expect(credentials).toBe('my-credentials');
    });
  });
  describe('method', () => {
    it('works for GET requests', async () => {
      expect.assertions(1);

      const link = new RestLink({ uri: '/api' });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id", method: "GET") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('works without specifying a request method', async () => {
      expect.assertions(1);

      const link = new RestLink({ uri: '/api' });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('throws if query method is not GET', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id", method: "POST") {
            id
            title
          }
        }
      `;

      try {
        await makePromise<Result>(
          execute(link, {
            operationName: 'postTitle',
            query: postTitleQuery,
            variables: { id: '1' },
          }),
        );
      } catch (error) {
        expect(error.message).toBe(
          'A "query" operation can only support "GET" requests but got "POST".',
        );
      }

      expect(fetchMock.called('/api/post/1')).toBe(false);
    });
  });

  /** Helper for extracting a simple object of headers from the HTTP-fetch Headers class */
  const flattenHeaders: ({ headers: Headers }) => { [key: string]: string } = ({
    headers,
  }) => {
    const headersFlattened: { [key: string]: string } = {};
    headers.forEach((value, key) => {
      headersFlattened[key] = value;
    });
    return headersFlattened;
  };

  /** Helper that flattens headers & preserves duplicate objects */
  const orderDupPreservingFlattenedHeaders: (
    { headers: Headers },
  ) => string[] = ({ headers }) => {
    const orderedFlattened = [];
    headers.forEach((value, key) => {
      orderedFlattened.push(`${key}: ${value}`);
    });
    return orderedFlattened;
  };

  describe('headers', () => {
    it('adds headers to the request from the context', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: { authorization: '1234' },
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new RestLink({ uri: '/api' }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(orderDupPreservingFlattenedHeaders(requestCall[1])).toEqual([
        'authorization: 1234',
      ]);
    });
    it('adds headers to the request from the setup', async () => {
      const link = new RestLink({
        uri: '/api',
        headers: { authorization: '1234' },
      });

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect({ headers: flattenHeaders(requestCall[1]) }).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: '1234',
          }),
        }),
      );
    });
    it('prioritizes context headers over setup headers', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: {
            authorization: '1234',
            // won't be overridden, will be duplicated because of headersToOverride
            setup: 'in-context duplicate setup',
            context: 'context',
          },
          headersToOverride: ['authorization'],
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new RestLink({
          uri: '/api',
          headers: { authorization: 'no user', setup: 'setup' },
        }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect(orderDupPreservingFlattenedHeaders(requestCall[1])).toEqual([
        'setup: setup',
        'setup: in-context duplicate setup',
        'authorization: 1234',
        'context: context',
      ]);
    });
    it('respects context-provided header-merge policy', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        /** This Merge Policy preserves the setup headers over the context headers */
        const headersMergePolicy: RestLink.HeadersMergePolicy = (
          ...headerGroups: Headers[]
        ) => {
          return headerGroups.reduce((accumulator, current) => {
            normalizeHeaders(current).forEach((value, key) => {
              if (!accumulator.has(key)) {
                accumulator.append(key, value);
              }
            });
            return accumulator;
          }, new Headers());
        };
        operation.setContext({
          headers: { authorization: 'context', context: 'context' },
          headersMergePolicy,
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new RestLink({
          uri: '/api',
          headers: { authorization: 'initial setup', setup: 'setup' },
        }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      expect({ headers: flattenHeaders(requestCall[1]) }).toEqual(
        expect.objectContaining({
          headers: expect.objectContaining({
            authorization: 'initial setup',
            setup: 'setup',
            context: 'context',
          }),
        }),
      );
    });
    it('preserves duplicative headers in their correct order', async () => {
      expect.assertions(2);

      const headersMiddleware = new ApolloLink((operation, forward) => {
        operation.setContext({
          headers: { authorization: 'context' },
        });
        return forward(operation).map(result => {
          const { headers } = operation.getContext();
          expect(headers).toBeDefined();
          return result;
        });
      });
      const link = ApolloLink.from([
        headersMiddleware,
        new RestLink({
          uri: '/api',
          headers: { authorization: 'initial setup' },
        }),
      ]);

      const post = { id: '1', title: 'Love apollo' };
      fetchMock.get('/api/post/1', post);

      const postTitleQuery = gql`
        query postTitle {
          post(id: "1") @rest(type: "Post", path: "/post/:id") {
            id
            title
          }
        }
      `;

      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTitleQuery,
          variables: { id: '1' },
        }),
      );

      const requestCall = fetchMock.calls('/api/post/1')[0];
      const { headers } = requestCall[1];
      const orderedFlattened = [];
      headers.forEach((value, key) => {
        orderedFlattened.push(`${key}: ${value}`);
      });
      expect(orderedFlattened).toEqual([
        'authorization: initial setup',
        'authorization: context',
      ]);
    });
  });
});

describe('Mutation', () => {
  describe('basic support', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('supports POST requests', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts/new', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          title: String
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @rest(type: "Post", path: "/posts/new", method: "POST") {
            id
            title
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: { title: post.title } },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/new')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
    });
    it('supports PUT requests', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.put('/api/posts/1', post);
      const resultPost = { __typename: 'Post', ...post };

      const replacePostMutation = gql`
        fragment ReplaceablePostInput on REST {
          id: ID
          title: String
        }

        mutation changePost($id: ID!, $input: ReplaceablePostInput!) {
          replacedPost(id: $id, input: $input)
            @rest(type: "Post", path: "/posts/:id", method: "PUT") {
            id
            title
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'republish',
          query: replacePostMutation,
          variables: { id: post.id, input: post },
        }),
      );
      expect(response.data.replacedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'PUT' }),
      );
    });
    it('supports PATCH requests', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo', categoryId: 6 };
      fetchMock.patch('/api/posts/1', post);
      const resultPost = { __typename: 'Post', ...post };

      const editPostMutation = gql`
        fragment PartialPostInput on REST {
          id: ID
          title: String
          categoryId: Number
        }

        mutation editPost($id: ID!, $input: PartialPostInput!) {
          editedPost(id: $id, input: $input)
            @rest(type: "Post", path: "/posts/:id", method: "PATCH") {
            id
            title
            categoryId
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'editPost',
          query: editPostMutation,
          variables: { id: post.id, input: { categoryId: post.categoryId } },
        }),
      );
      expect(response.data.editedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'PATCH' }),
      );
    });
    it('supports DELETE requests', async () => {
      expect.assertions(1);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.delete('/api/posts/1', post);

      const replacePostMutation = gql`
        mutation deletePost($id: ID!) {
          deletePostResponse(id: $id)
            @rest(type: "Post", path: "/posts/:id", method: "DELETE") {
            NoResponse
          }
        }
      `;
      await makePromise<Result>(
        execute(link, {
          operationName: 'deletePost',
          query: replacePostMutation,
          variables: { id: post.id },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/1')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  describe('fieldNameDenormalizer', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('corrects names to snake_case for link-level denormalizer', async () => {
      expect.assertions(3);

      const link = new RestLink({
        uri: '/api',
        fieldNameNormalizer: camelCase,
        fieldNameDenormalizer: snake_case,
      });

      // the id in this hash simulates the server *assigning* an id for the new post
      const snakePost = { title_string: 'Love apollo', category_id: 6 };
      const camelPost = { titleString: 'Love apollo', categoryId: 6 };
      fetchMock.post('/api/posts/new', { id: 1, ...snakePost });
      const intermediatePost = snakePost;
      const resultPost = { ...camelPost, id: 1 };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          titleString: String
          categoryId: Number
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @rest(type: "Post", path: "/posts/new", method: "POST") {
            id
            titleString
            categoryId
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: camelPost },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/new')[0];

      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(JSON.parse(requestCall[1].body)).toMatchObject(intermediatePost);

      expect(response.data.publishedPost).toEqual(
        expect.objectContaining(resultPost),
      );
    });
    it('corrects names to snake_case for request-level denormalizer', async () => {
      expect.assertions(3);

      const link = new RestLink({
        uri: '/api',
        fieldNameNormalizer: camelCase,
      });

      // the id in this hash simulates the server *assigning* an id for the new post
      const snakePost = { title_string: 'Love apollo', category_id: 6 };
      const camelPost = { titleString: 'Love apollo', categoryId: 6 };
      fetchMock.post('/api/posts/new', { id: 1, ...snakePost });
      const intermediatePost = snakePost;
      const resultPost = { ...camelPost, id: 1 };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          titleString: String
          categoryId: Int
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @rest(
              type: "Post"
              path: "/posts/new"
              method: "POST"
              fieldNameDenormalizer: $requestLevelDenormalizer
            ) {
            id
            titleString
            categoryId
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: camelPost, requestLevelDenormalizer: snake_case },
        }),
      );

      const requestCall = fetchMock.calls('/api/posts/new')[0];

      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
        }),
      );
      expect(JSON.parse(requestCall[1].body)).toMatchObject(intermediatePost);

      expect(response.data.publishedPost).toEqual(
        expect.objectContaining(resultPost),
      );
    });
  });
  describe('bodyKey/bodyBuilder', () => {
    afterEach(() => {
      fetchMock.restore();
    });
    it('builds request body containing Strings/Objects/Arrays types without changing their types', async () => {
      // tests convertObjectKeys functionality
      // see: https://github.com/apollographql/apollo-link-rest/issues/45
      expect.assertions(3);

      const link = new RestLink({ uri: '/api' });

      //body containing Primitives, Objects and Arrays types
      const post = {
        id: '1',
        title: 'Love apollo',
        items: [{ name: 'first' }, { name: 'second' }],
      };

      fetchMock.post('/api/posts/newComplexPost', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment Item on any {
          name: String
        }

        fragment PublishablePostInput on REST {
          id: String
          title: String
          items {
            ...Item
          }
        }

        mutation publishPost($input: PublishablePostInput!) {
          publishedPost(input: $input)
            @rest(type: "Post", path: "/posts/newComplexPost", method: "POST") {
            id
            title
            items
          }
        }
      `;

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { input: post },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/newComplexPost')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
      expect(requestCall[1].body).toEqual(JSON.stringify(post));
    });

    it('respects bodyKey for mutations', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts/new', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          title: String
        }

        mutation publishPost(
          $someApiWithACustomBodyKey: PublishablePostInput!
        ) {
          publishedPost(someApiWithACustomBodyKey: $someApiWithACustomBodyKey)
            @rest(
              type: "Post"
              path: "/posts/new"
              method: "POST"
              bodyKey: "someApiWithACustomBodyKey"
            ) {
            id
            title
          }
        }
      `;
      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: { someApiWithACustomBodyKey: { title: post.title } },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/new')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({ method: 'POST' }),
      );
    });
    it('respects bodyBuilder for mutations', async () => {
      expect.assertions(2);

      const link = new RestLink({ uri: '/api' });

      // the id in this hash simulates the server *assigning* an id for the new post
      const post = { id: '1', title: 'Love apollo' };
      fetchMock.post('/api/posts/new', post);
      const resultPost = { __typename: 'Post', ...post };

      const createPostMutation = gql`
        fragment PublishablePostInput on REST {
          title: String
        }

        mutation publishPost(
          $input: PublishablePostInput!
          $customBuilder: any
        ) {
          publishedPost(input: $input)
            @rest(
              type: "Post"
              path: "/posts/new"
              method: "POST"
              bodyBuilder: $customBuilder
            ) {
            id
            title
          }
        }
      `;
      function fakeEncryption(args) {
        return 'MAGIC_PREFIX' + JSON.stringify(args.input);
      }

      const response = await makePromise<Result>(
        execute(link, {
          operationName: 'publishPost',
          query: createPostMutation,
          variables: {
            input: { title: post.title },
            customBuilder: fakeEncryption,
          },
        }),
      );
      expect(response.data.publishedPost).toEqual(resultPost);

      const requestCall = fetchMock.calls('/api/posts/new')[0];
      expect(requestCall[1]).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(
            fakeEncryption({ input: { title: post.title } }),
          ),
        }),
      );
    });
  });
});

describe('validateRequestMethodForOperationType', () => {
  describe('for operation type "mutation"', () => {
    it('throws because it is not supported yet', () => {
      expect.assertions(2);
      expect(() =>
        validateRequestMethodForOperationType('GET', 'mutation'),
      ).toThrowError('"mutation" operations do not support that HTTP-verb');
      expect(() =>
        validateRequestMethodForOperationType('GIBBERISH', 'mutation'),
      ).toThrowError('"mutation" operations do not support that HTTP-verb');
    });
  });
  describe('for operation type "subscription"', () => {
    it('throws because it is not supported yet', () => {
      expect.assertions(1);
      expect(() =>
        validateRequestMethodForOperationType('GET', 'subscription'),
      ).toThrowError('A "subscription" operation is not supported yet.');
    });
  });
});

describe('export directive', () => {
  afterEach(() => {
    fetchMock.restore();
  });
  it('should throw an error if export is missing', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo', tagId: 6 };
    fetchMock.get('/api/post/1', post);

    const postTagWithoutExport = gql`
      query postTitle {
        post(id: "1") @rest(type: "Post", path: "/post/:id") {
          tagId
          title
          tag @rest(type: "Tag", path: "/tag/:tagId") {
            name
          }
        }
      }
    `;

    try {
      await makePromise<Result>(
        execute(link, {
          operationName: 'postTitle',
          query: postTagWithoutExport,
          variables: { id: '1' },
        }),
      );
    } catch (e) {
      expect(e.message).toBe(
        'Missing params to run query, specify it in the query params or use an export directive',
      );
    }
  });
  it('can use a variable from export', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo', tagId: 6 };
    fetchMock.get('/api/post/1', post);
    const tag = { name: 'apollo' };
    fetchMock.get('/api/tag/6', tag);

    const postTagExport = gql`
      query postTitle {
        post(id: "1") @rest(type: "Post", path: "/post/:id") {
          tagId @export(as: "tagId")
          title
          tag @rest(type: "Tag", path: "/tag/:tagId") {
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTagExport,
        variables: { id: '1' },
      }),
    );

    expect(data.post.tag).toEqual({ ...tag, __typename: 'Tag' });
  });

  it('can use two variables from export', async () => {
    expect.assertions(2);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo', tagId: 6, postAuthor: 10 };
    fetchMock.get('/api/post/1', post);
    const tag = { name: 'apollo' };
    fetchMock.get('/api/tag/6', tag);
    const author = { name: 'Sashko' };
    fetchMock.get('/api/users/10', author);

    const postTagExport = gql`
      query postTitle {
        post(id: "1") @rest(type: "Post", path: "/post/:id") {
          tagId @export(as: "tagId")
          postAuthor @export(as: "authorId")
          title
          tag @rest(type: "Tag", path: "/tag/:tagId") {
            name
          }
          author @rest(type: "User", path: "/users/:authorId") {
            name
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postTitle',
        query: postTagExport,
        variables: { id: '1' },
      }),
    );

    expect(data.post.tag).toEqual({ ...tag, __typename: 'Tag' });
    expect(data.post.author).toEqual({ ...author, __typename: 'User' });
  });
});

describe('Apollo client integration', () => {
  afterEach(() => {
    fetchMock.restore();
  });

  it('can integrate with apollo client', async () => {
    expect.assertions(1);

    const link = new RestLink({ uri: '/api' });

    const post = { id: '1', title: 'Love apollo' };
    fetchMock.get('/api/post/1', post);

    const postTagExport = gql`
      query {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
        }
      }
    `;

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    const { data }: { data: any } = await client.query({
      query: postTagExport,
    });

    expect(data.post).toBeDefined();
  });

  it('treats absent response fields as optional', async done => {
    // Discovered in: https://github.com/apollographql/apollo-link-rest/issues/74

    const link = new RestLink({ uri: '/api' });

    const post = {
      id: '1',
      title: 'Love apollo',
      content: 'Best graphql client ever.',
    };
    const comments = [{ id: 'c.12345', text: 'This is great.' }];
    fetchMock.get('/api/post/1', post);
    fetchMock.get('/api/post/1/comments', comments);

    const postTitleQuery = gql`
      query postTitle {
        post @rest(type: "Post", path: "/post/1") {
          id
          title
          unfairCriticism
          comments @rest(type: "Comment", path: "/post/1/comments") {
            id
            text
            spammyContent
          }
        }
      }
    `;

    const { data } = await makePromise<Result>(
      execute(link, {
        operationName: 'postWithContent',
        query: postTitleQuery,
      }),
    );

    expect(data.post.unfairCriticism).toBeNull();

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link,
    });

    const { data: data2 }: { data: any } = await client.query({
      query: postTitleQuery,
    });
    expect(data2.post.unfairCriticism).toBeNull();

    const errorLink = onError(opts => {
      console.error(opts);
      const { networkError, graphQLErrors } = opts;
      expect(
        networkError || (graphQLErrors && graphQLErrors.length > 0),
      ).toBeTruthy();
    });
    const combinedLink = ApolloLink.from([
      new RestLink({
        uri: '/api',
        typePatcher: {
          Post: (
            data: any,
            outerType: string,
            patchDeeper: RestLink.FunctionalTypePatcher,
          ): any => {
            // Let's make unfairCriticism a Required Field
            if (data.unfairCriticism == null) {
              throw new Error(
                'Required Field: unfairCriticism missing in RESTResponse.',
              );
            }
            return data;
          },
        },
      }),
      errorLink,
    ]);
    const client3 = new ApolloClient({
      cache: new InMemoryCache(),
      link: combinedLink,
    });
    try {
      const result = await client3.query({
        query: postTitleQuery,
      });
      const { errors } = result;
      if (errors && errors.length > 0) {
        throw new Error('All is well, errors were thrown as expected');
      }
      done.fail('query should throw some sort of error');
    } catch (error) {
      done();
    }
  });

  it('can catch HTTP Status errors', async done => {
    const link = new RestLink({ uri: '/api' });

    const status = 404;

    // setup onError link
    const errorLink = onError(opts => {
      const { networkError } = opts;
      if (networkError != null) {
        //console.debug(`[Network error]: ${networkError}`);
        const { statusCode } = networkError as RestLink.ServerError;
        expect(statusCode).toEqual(status);
      }
    });
    const combinedLink = ApolloLink.from([errorLink, link]);

    const client = new ApolloClient({
      cache: new InMemoryCache(),
      link: combinedLink,
    });

    fetchMock.mock('/api/post/1', {
      status,
      body: { id: 1 },
    });

    try {
      await client.query({
        query: sampleQuery,
      });
      done.fail('query should throw a network error');
    } catch (error) {
      done();
    }
  });

  it('supports being cancelled and does not throw', done => {
    class AbortError extends Error {
      constructor(message) {
        super(message);
        this.name = message;
      }
    }
    const customFetch = () =>
      new Promise((_, reject) => {
        reject(new AbortError('AbortError'));
      });

    const link = new RestLink({
      uri: '/api',
      customFetch: customFetch as any,
    });

    const sub = execute(link, { query: sampleQuery }).subscribe({
      next: () => {
        done.fail('result should not have been called');
      },
      error: e => {
        done.fail(e);
      },
      complete: () => {
        done.fail('complete should not have been called');
      },
    });

    setTimeout(() => {
      sub.unsubscribe();
      done();
    }, 0);
  });
});
