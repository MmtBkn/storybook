import { getOptions } from 'loader-utils';
import path from 'path';
import injectDecorator from '../abstract-syntax-tree/inject-decorator';

const ADD_DECORATOR_STATEMENT =
  '.addDecorator(withStorySource(__STORY__, __ADDS_MAP__,__MAIN_FILE_LOCATION__,__MODULE_DEPENDENCIES__,__LOCAL_DEPENDENCIES__))';

function extractDependenciesFrom(tree) {
  return !Object.entries(tree || {}).length
    ? []
    : Object.entries(tree)
        .map(([, value]) =>
          (value.dependencies || []).concat(extractDependenciesFrom(value.localDependencies))
        )
        .reduce((acc, value) => acc.concat(value), []);
}

function extractLocalDependenciesFrom(tree) {
  return Object.assign(
    {},
    ...Object.entries(tree || {}).map(([thisPath, value]) =>
      Object.assign(
        { [thisPath]: { code: value.source } },
        extractLocalDependenciesFrom(value.localDependencies)
      )
    )
  );
}

export function readAsObject(classLoader, inputSource) {
  const options = getOptions(classLoader) || {};
  const result = injectDecorator(
    inputSource,
    ADD_DECORATOR_STATEMENT,
    classLoader.resourcePath,
    options
  );

  const sourceJson = JSON.stringify(result.storySource || inputSource)
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  const addsMap = result.addsMap || {};
  const dependencies = result.dependencies || [];
  const source = result.source || inputSource;
  const resource = classLoader.resourcePath || classLoader.resource;

  const moduleDependencies = (result.dependencies || []).filter(d => d[0] === '.' || d[0] === '/');
  const workspaceFileNames = moduleDependencies.map(d => path.join(path.dirname(resource), d));

  return Promise.all(
    workspaceFileNames.map(
      d =>
        new Promise(resolve =>
          classLoader.loadModule(d, (err, dependencyFile, sourceMap, theModule) => {
            resolve({
              d,
              err,
              dependencyFile,
              sourceMap,
              theModule,
            });
          })
        )
    )
  )
    .then(data =>
      Promise.all(
        data.map(({ dependencyFile, theModule }) =>
          readAsObject(
            Object.assign({}, classLoader, {
              resourcePath: theModule.resourcePath,
              resource: theModule.resource,
            }),
            dependencyFile
          )
        )
      ).then(moduleObjects =>
        Object.assign(
          {},
          ...moduleObjects.map(asObject => ({
            [asObject.resource]: asObject,
          }))
        )
      )
    )
    .then(localDependencies => ({
      resource,
      source,
      sourceJson,
      addsMap,
      dependencies: dependencies
        .concat(extractDependenciesFrom(localDependencies))
        .filter(d => d[0] !== '.' && d[0] !== '/')
        .map(d => (d[0] === '@' ? `${d.split('/')[0]}/${d.split('/')[1]}` : d.split('/')[0])),
      localDependencies: Object.assign(
        ...Object.entries(localDependencies).map(([name, value]) => ({
          [name]: { code: value.source },
        })),
        extractLocalDependenciesFrom(localDependencies)
      ),
    }));
}
