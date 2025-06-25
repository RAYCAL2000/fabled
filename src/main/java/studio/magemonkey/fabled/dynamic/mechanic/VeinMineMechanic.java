package studio.magemonkey.fabled.dynamic.mechanic;

import org.bukkit.*;
import org.bukkit.block.Block;
import org.bukkit.block.data.BlockData;
import org.bukkit.entity.LivingEntity;
import org.bukkit.entity.Player;
import org.bukkit.inventory.EntityEquipment;
import org.bukkit.inventory.ItemStack;
import org.bukkit.scheduler.BukkitRunnable;
import org.bukkit.util.Vector;
import studio.magemonkey.fabled.Fabled;

import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Supplier;

public class VeinMineMechanic extends MechanicComponent {

    private static final Vector[] NEIGHBOR_OFFSETS = {
            new Vector(1, 0, 0), new Vector(-1, 0, 0),
            new Vector(0, 1, 0), new Vector(0, -1, 0),
            new Vector(0, 0, 1), new Vector(0, 0, -1)
    };

    private static final String MATERIALS = "materials";
    private static final String DROP = "drop";
    private static final String TOOL = "tool";
    private static final String DISTANCE = "distance";
    private static final String AMOUNT = "amount";

    @Override
    public String getKey() {
        return "vein mine";
    }

    @Override
    public boolean execute(LivingEntity caster, int level, List<LivingEntity> targets, boolean force) {
        if (targets.isEmpty()) return false;

        LivingEntity target = targets.get(0);
        Block originBlock = target.getLocation().getBlock();
        Material originMaterial = originBlock.getType();
        String originMaterialName = originMaterial.name();

        List<String> materialList = settings.getStringList(MATERIALS);
        boolean drop = settings.getBool(DROP, true);
        boolean any = materialList.stream().anyMatch(s -> s.equalsIgnoreCase("any"));
        boolean originMatch = materialList.stream().anyMatch(s -> s.equalsIgnoreCase("origin"));

        Set<Material> materialSet = new HashSet<>();
        for (String mat : materialList) {
            Material m = Material.matchMaterial(mat.toUpperCase(Locale.ROOT).replace(' ', '_'));
            if (m != null) materialSet.add(m);
        }

        int maxDistance = settings.getInt(DISTANCE, 5);
        int maxBlocks = settings.getInt(AMOUNT, 100);

        ItemStack tool = resolveTool(caster, target, settings.getString(TOOL, "CASTER"));

        veinMine(originBlock, tool, drop,
            any ? null : materialSet,
            originMatch ? originMaterialName : null,
            maxDistance, maxBlocks);

        return true;
    }

private void veinMine(Block origin,
                             ItemStack tool,
                             boolean drop,
                             Set<Material> allowedMaterials,
                             String originName,
                             int maxDistance,
                             int maxBlocks) {

    Queue<Block> queue = new LinkedList<>();
    queue.add(origin);

    int brokenCount = 0;

    while (!queue.isEmpty() && brokenCount < maxBlocks) {
        Block current = queue.poll();

        if (current.getType() == Material.AIR) continue;
        if (current.getLocation().distanceSquared(origin.getLocation()) > maxDistance * maxDistance) continue;

        Material type = current.getType();
        String name = type.name();
        if (allowedMaterials != null && !allowedMaterials.contains(type)) {
            if (originName == null || !name.equals(origin.getType().name())) continue;
        }

        // Break block
        if (drop) {
            current.breakNaturally(tool);
        } else {
            current.setType(Material.AIR);
        }

        // Effects
        Location loc = current.getLocation().add(0.5, 0.5, 0.5);
        BlockData data = current.getBlockData();
        current.getWorld().spawnParticle(Particle.BLOCK_CRACK, loc, 10, 0.3, 0.3, 0.3, 0, data);
        current.getWorld().playSound(loc, Sound.BLOCK_STONE_BREAK, 1.0f, 1.0f);

        brokenCount++;

        // Queue 6-directional neighbors
        for (Vector offset : NEIGHBOR_OFFSETS) {
            Block neighbor = current.getRelative(offset.getBlockX(), offset.getBlockY(), offset.getBlockZ());
            if (neighbor.getType() != Material.AIR) {
                queue.add(neighbor);
            }
        }
    }
}


    private ItemStack resolveTool(LivingEntity caster, LivingEntity target, String source) {
        source = source.toUpperCase(Locale.ROOT).replace(' ', '_');
        if (source.equals("CASTER")) {
            EntityEquipment equipment = caster.getEquipment();
            return (equipment != null) ? equipment.getItemInMainHand() : new ItemStack(Material.AIR);
        } else if (source.equals("TARGET")) {
            EntityEquipment equipment = target.getEquipment();
            return (equipment != null) ? equipment.getItemInMainHand() : new ItemStack(Material.AIR);
        } else {
            try {
                return new ItemStack(Material.valueOf(source));
            } catch (IllegalArgumentException e) {
                return new ItemStack(Material.AIR);
            }
        }
    }

    @Override
    public void playPreview(List<Runnable> onPreviewStop,
                            Player caster,
                            int level,
                            Supplier<List<LivingEntity>> targetSupplier) {
        // You can add visual preview logic here if desired
    }
}