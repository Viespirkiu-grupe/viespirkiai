import Sigma from 'sigma';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import { NodeBorderProgram } from '@sigma/node-border';
import { NodeImageProgram } from '@sigma/node-image';

window.Voratinklis = { Sigma, Graph, forceAtlas2, noverlap, NodeBorderProgram, NodeImageProgram };
