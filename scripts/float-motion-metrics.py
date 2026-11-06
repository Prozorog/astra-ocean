"""Compare observed live trajectories, never seek-derived ball poses."""
import argparse, json, math
from pathlib import Path
ROOT=Path(__file__).resolve().parent.parent
parser=argparse.ArgumentParser()
parser.add_argument('--before',default='before');parser.add_argument('--after',default='final')
parser.add_argument('--out',default='output/playwright/float-water')
args=parser.parse_args()
DATA=ROOT/'output/playwright/float-water'
OUT=ROOT/args.out;OUT.mkdir(parents=True,exist_ok=True)
RADIUS=.575
norm=lambda a:math.sqrt(sum(v*v for v in a))
def percentile(values,p):return sorted(values)[min(len(values)-1,int(len(values)*p))] if values else None
def analyse(stage,name):
    rows=json.loads((DATA/stage/f'{name}-trace.json').read_text());steps=[];immersions=[];outside=0;max_outside=0
    for a,b in zip(rows,rows[1:]):
        dt=(b['phase']-a['phase'])%3.63
        if dt<.0001:continue
        delta=[b['ball'][i]-a['ball'][i] for i in range(3)]
        predicted=[.5*(a['velocity'][i]+b['velocity'][i])*dt for i in range(3)]
        integrated=b.get('integration')
        estimate=integrated['velocityIntegral'] if integrated else predicted
        floating=a['mode'] in ['track','bobbing'] and b['mode'] in ['track','bobbing']
        residual=norm([delta[i]-estimate[i] for i in range(3)])
        step={'phase':b['phase'],'dt':dt,'distance':norm(delta),'apparentVelocity':[v/dt for v in delta],'residual':residual,'endpointTrapezoidResidual':norm([delta[i]-predicted[i] for i in range(3)]),'integratorSubsteps':integrated['substeps'] if integrated else None,'floating':floating,'newProbe':b['probe']['receivedAt']!=a['probe']['receivedAt'],'mode':a['mode']+'->'+b['mode'],'seam':b['phase']<a['phase']}
        steps.append(step)
        s=b.get('support')
        if name=='idle' and s and s['valid']:
            # Support plane is fitted at the previous floating position before
            # integration. Rigid root rotation preserves this signed distance.
            to_centre=[delta[0],b['ball'][1]-s['y'],delta[2]]
            distance=sum(to_centre[i]*s['normal'][i] for i in range(3))
            fraction=(RADIUS-distance)/(2*RADIUS);immersions.append(fraction)
            outside=outside+dt if fraction<.05 or fraction>.75 else 0;max_outside=max(max_outside,outside)
    floating=[s for s in steps if s['floating'] and (s['integratorSubsteps'] or s['dt']<=.101)]
    accelerations=[]
    for a,b in zip(steps,steps[1:]):
        if a['floating'] and b['floating'] and max(a['dt'],b['dt'])<=.101:
            accelerations.append(norm([2*(b['apparentVelocity'][i]-a['apparentVelocity'][i])/(a['dt']+b['dt']) for i in range(3)]))
    return {'frames':len(rows),'seconds':(rows[-1]['wall']-rows[0]['wall'])/1000,'phaseCrossings':sum(s['seam'] for s in steps),'p95FrameMs':percentile([(b['wall']-a['wall']) for a,b in zip(rows,rows[1:])],.95),
      'maxUnexplainedFloatingStep':max(s['residual'] for s in floating),'rmsUnexplainedFloatingStep':math.sqrt(sum(s['residual']**2 for s in floating)/len(floating)),
      'maxEndpointTrapezoidResidual':max(s['endpointTrapezoidResidual'] for s in floating),'integratedVelocityFrames':sum(bool(s['integratorSubsteps']) for s in floating),
      'p95ApparentFloatingAcceleration':percentile(accelerations,.95),'maxFloatingStepAtUnder25ms':max((s['distance'] for s in floating if s['dt']<.025),default=None),
      'maxFloatingStep':max(s['distance'] for s in floating),
      'largeSteps':sum(s['floating'] and s['distance']>.12 for s in steps),'largeStepsOnProbe':sum(s['floating'] and s['distance']>.12 and s['newProbe'] for s in steps),
      'transitions':[s for s in steps if s['mode'].split('->')[0]!=s['mode'].split('->')[1]],'seams':[s for s in steps if s['seam']],
      'immersion':{'samples':len(immersions),'p05':percentile(immersions,.05),'median':percentile(immersions,.5),'p95':percentile(immersions,.95),'longestNearDryOrDeepSeconds':max_outside,'method':'Sphere/fit-plane signed distance, from carrier samples outside sphere-volume mask; not a screenshot colour mask.'}}
report={'method':'Live RAF trajectories, no seek. Compare rendered position with independently quadrature-integrated own velocity at actual response substeps (observation-only hook, no state writes). Preserve endpoint-only trapezoid residual as a diagnostic: it is inaccurate during nonlinear forcing on long frames. Historic kinematic track has zero own velocity. Contacts/holding/flight excluded from floating residual, not from saved traces. Threshold remains .035 scene units; all witnessed floating frames, including long ones, are checked.','stages':{}}
for stage in dict.fromkeys([args.before,args.after]):
    directory=DATA/stage
    if not (directory/'idle-trace.json').exists():continue
    report['stages'][stage]={name:analyse(stage,name) for name in ['idle','throw'] if (directory/f'{name}-trace.json').exists()}
final=report['stages'][args.after]
assert final['idle']['integratedVelocityFrames']>100,'Continuity proof requires actual substep velocity observations'
assert final['idle']['maxUnexplainedFloatingStep']<.035,final['idle']
assert final['idle']['immersion']['longestNearDryOrDeepSeconds']<.3,final['idle']['immersion']
handoffs=[s for s in final['throw']['transitions'] if s['mode']=='bobbing->track']
assert handoffs and all(s['residual']<.035 for s in handoffs),handoffs
rows=json.loads((DATA/args.after/'tap-seam-trace.json').read_text())
report['tapSeam']={'frames':len(rows),'crossings':sum(b['phase']<a['phase'] for a,b in zip(rows,rows[1:])),
 'beforeMaxAbsMetres':max(abs(r['heightfieldAtTap']) for r in rows if r['phase']>3.5),
 'afterMaxAbsMetres':max(abs(r['heightfieldAtTap']) for r in rows if r['phase']<.5),
 'resets':json.loads((DATA/args.after/'checks.json').read_text())['seam']['resets']}
assert report['tapSeam']['crossings']>=1 and report['tapSeam']['resets']==0
assert report['tapSeam']['beforeMaxAbsMetres']>1e-5 and report['tapSeam']['afterMaxAbsMetres']>1e-5
report['passed']=True
(OUT/'motion-metrics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
print(json.dumps({'passed':True,'before':report['stages'][args.before]['idle'],'final':final,'tapSeam':report['tapSeam']},indent=2))
