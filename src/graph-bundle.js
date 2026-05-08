import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import { NodeBorderProgram } from '@sigma/node-border';
import { NodeImageProgram, createNodeImageProgram } from '@sigma/node-image';
import { animateNodes } from 'sigma/utils';
import EdgeCurveProgram, { DEFAULT_EDGE_CURVATURE, indexParallelEdgesIndex } from '@sigma/edge-curve';

export function createSigma(graph, container, options) {
    const { edgeProgramClasses, ...rest } = options || {};
    return new Sigma(graph, container, {
        ...rest,
        edgeProgramClasses: {
            curved: EdgeCurveProgram,
            ...(edgeProgramClasses || {}),
        },
    });
}

export {
    Sigma,
    Graph,
    forceAtlas2,
    noverlap,
    NodeBorderProgram,
    NodeImageProgram,
    createNodeImageProgram,
    animateNodes,
    DEFAULT_EDGE_CURVATURE,
    indexParallelEdgesIndex,
};
